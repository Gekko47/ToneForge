/**
 * Hybrid consistency checker (Stage 20).
 *
 * Orchestrates deterministic typography and house-style engines, the
 * deterministic formatting analyzer, and the semantic deviation engine,
 * merges the outputs through `unifyFindings`, and returns a findings-only
 * report with a summary of counts by severity and kind plus profileId and
 * docHash. No `ChangePlan` is generated here — the Stage 21 orchestrator
 * composes this output with the Stage 17 planner.
 *
 * Boundary rule: this module is semantic, not deterministic. It may import
 * from `core/domain`, `rules`, `formatting`, `ai/providers`, `ai/prompts`,
 * and `shared/utils` — never `ui` or `word/revisionAdapter` (see
 * ADR-0023 and the `src/analysis/**` ESLint scope). It never calls
 * `Office.run` or mutates Word.
 */

import { z } from "zod";
import { findTypographyIssues } from "../rules/typography";
import { findHouseStyleIssues } from "../rules/houseStyle";
import { findFormattingIssues } from "../formatting/analyzer";
import type { FormattingSnapshot } from "../formatting/formattingSnapshot";
import { FormattingSnapshotSchema } from "../formatting/formattingSnapshot";
import { unifyFindings } from "./unifiedFindings";
import { detectSemanticDeviations } from "./deviationEngine";
import { buildCoverage } from "./coverage";
import type { AnalysisContext } from "./analysisContext";
import { logger } from "../shared/utils/logger";
import { FindingSchema } from "../core/domain/Finding";
import type { Finding } from "../core/domain/Finding";
import { createGovernanceProfile, type GovernanceProfile } from "../core/domain/GovernanceProfile";
import { StyleProfileSchema } from "../core/domain/StyleProfile";
import type { StyleProfile } from "../core/domain/StyleProfile";
import { resolveResolvedPolicy, type ResolvedPolicy } from "../core/domain/ResolvedPolicy";
import type { DeviationOptions } from "./deviationEngine";
import type { LlmSemanticProvider } from "../ai/providers/LlmProvider";
import type { DocumentNode } from "../core/domain/DocumentSnapshot";

/** Lightweight FNV-1a hash used when the caller does not supply one. */
function hashText(text: string): string {
  let hash = 2166136261 >>> 0;
  [...text].forEach((char) => {
    hash = (hash ^ char.charCodeAt(0)) >>> 0;
    hash = (hash * 16777619) >>> 0;
  });
  return hash.toString(16).padStart(8, "0");
}

export const ConsistencySummarySchema = z.object({
  total: z.number().int().nonnegative(),
  bySeverity: z.object({
    info: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
  }),
  byKind: z.object({
    deterministic: z.number().int().nonnegative(),
    formatting: z.number().int().nonnegative(),
    semantic: z.number().int().nonnegative(),
  }),
});

export type ConsistencySummary = z.infer<typeof ConsistencySummarySchema>;

export const ConsistencyReportSchema = z.object({
  findings: z.array(FindingSchema),
  summary: ConsistencySummarySchema,
  profileId: z.string().uuid(),
  docHash: z.string().trim().min(1),
  semanticStatus: z.enum(["ok", "skipped", "degraded"]).default("ok"),
  semanticError: z.string().optional(),
  coverage: z
    .object({
      runId: z.string().uuid(),
      counts: z
        .array(
          z.object({
            nodeType: z.string(),
            count: z.number().int().nonnegative(),
            processedCharacterCount: z.number().int().nonnegative(),
            revisedCharacterCount: z.number().int().nonnegative(),
            excluded: z
              .array(z.object({ reason: z.string(), locations: z.array(z.string()).max(10) }))
              .default([]),
          }),
        )
        .default([]),
      processedCharacterCount: z.number().int().nonnegative(),
      revisedCharacterCount: z.number().int().nonnegative(),
      examinedNodeIds: z.array(z.string()).default([]),
      excluded: z
        .array(z.object({ reason: z.string(), locations: z.array(z.string()).max(10) }))
        .default([]),
      unsupported: z.array(z.string()).default([]),
      unprocessed: z.array(z.string()).default([]),
      plannedChangeCount: z.number().int().nonnegative().default(0),
      appliedChangeCount: z.number().int().nonnegative().default(0),
      changedNodeIds: z.array(z.string()).default([]),
      acquisition: z
        .object({
          acquisitionReadCount: z.number().int().nonnegative(),
          syncCount: z.number().int().nonnegative(),
          analyzedCharacterCount: z.number().int().nonnegative(),
          completeDocumentCharacterCount: z.number().int().nonnegative(),
          fullBodyReadCount: z.number().int().nonnegative(),
          paragraphCollectionRead: z.boolean(),
          incremental: z.literal(false),
          incrementalReason: z.string().trim().min(1),
        })
        .optional(),
      complete: z.boolean().default(true),
    })
    .optional(),
});

export type ConsistencyReport = z.infer<typeof ConsistencyReportSchema>;

export interface CheckConsistencyOptions {
  text?: string;
  profile?: StyleProfile;
  /** Normative policy; analysis resolves it with the learned profile. */
  policy?: GovernanceProfile;
  /** Pre-resolved policy for callers that already own the canonical snapshot. */
  resolvedPolicy?: ResolvedPolicy;
  snapshot?: FormattingSnapshot;
  docHash?: string;
  includeRawText?: boolean;
  signal?: AbortSignal;
  /** Injected semantic provider; tests use MockAdapter only. */
  registry?: LlmSemanticProvider;
  nodes?: DocumentNode[];
  context?: AnalysisContext;
}

function emptySummary(): ConsistencySummary {
  return {
    total: 0,
    bySeverity: { info: 0, warning: 0, error: 0 },
    byKind: { deterministic: 0, formatting: 0, semantic: 0 },
  };
}

function summarize(findings: Finding[]): ConsistencySummary {
  const summary = emptySummary();
  findings.forEach((finding) => {
    summary.total += 1;
    summary.bySeverity[finding.severity] += 1;
    summary.byKind[finding.kind] += 1;
  });
  return summary;
}

export interface SemanticStatus {
  status: "ok" | "skipped" | "degraded";
  error?: string;
}

function buildReport(
  findings: Finding[],
  profileId: string,
  docHash: string,
  semantic?: SemanticStatus,
  coverage?: ConsistencyReport["coverage"],
): ConsistencyReport {
  const status = semantic?.status ?? "ok";
  if (status === "degraded" && semantic?.error !== undefined) {
    return ConsistencyReportSchema.parse({
      findings,
      summary: summarize(findings),
      profileId,
      docHash,
      semanticStatus: status,
      semanticError: semantic.error,
      coverage,
    });
  }
  return ConsistencyReportSchema.parse({
    findings,
    summary: summarize(findings),
    profileId,
    docHash,
    semanticStatus: status,
    coverage,
  });
}

/**
 * Run the hybrid consistency check.
 *
 * Deterministic engines always run. Formatting runs only when a snapshot is
 * supplied. Semantic runs only when `includeRawText` is true; otherwise the
 * semantic array is empty and no LLM call is made.
 *
 * Empty or whitespace-only text short-circuits to an empty report with zeroed
 * summary and no provider calls.
 */
export async function checkConsistency(
  options: CheckConsistencyOptions,
): Promise<ConsistencyReport> {
  const context = options.context;
  const text = context?.text ?? options.text;
  const docHash = options.docHash ?? context?.identity.contentHash;
  const includeRawText = options.includeRawText ?? false;
  const { signal, registry } = options;
  if (text === undefined || text === null) {
    throw new Error("checkConsistency requires text or an AnalysisContext");
  }

  // Parse inputs at the boundary so malformed profile/snapshot fail fast
  // with typed Zod errors instead of throwing deep inside engines.
  const profileInput = context?.profile ?? options.profile;
  if (profileInput === undefined) {
    throw new Error("checkConsistency requires a StyleProfile or an AnalysisContext");
  }
  const profile = StyleProfileSchema.parse(profileInput);
  const governance = context?.policy ?? options.policy ?? createGovernanceProfile(profile);
  const resolvedPolicy = options.resolvedPolicy ?? resolveResolvedPolicy(profile, governance);
  const analysisProfile = StyleProfileSchema.parse({
    ...profile,
    typography: resolvedPolicy.typography,
    houseStyle: resolvedPolicy.houseStyle,
    semantic: resolvedPolicy.semantic,
  });
  const snapshotInput = context?.formatting ?? options.snapshot;
  const snapshot = snapshotInput ? FormattingSnapshotSchema.parse(snapshotInput) : undefined;

  const nodes = context?.nodes ?? options.nodes;
  const coverage =
    nodes && nodes.length > 0
      ? buildCoverage({
          nodes,
          text,
          ...(context ? { acquisition: context.acquisition } : {}),
        })
      : undefined;
  if (text.trim().length === 0) {
    return buildReport([], profile.id, docHash ?? hashText(text), { status: "skipped" }, coverage);
  }

  const deterministic: Finding[] = [];
  deterministic.push(...findTypographyIssues({ text, rules: analysisProfile.typography }));
  deterministic.push(...findHouseStyleIssues({ text, rules: analysisProfile.houseStyle }));

  const formatting: Finding[] = snapshot ? findFormattingIssues({ snapshot }) : [];

  let semantic: Finding[] = [];
  let semanticStatus: SemanticStatus = includeRawText ? { status: "ok" } : { status: "skipped" };
  if (includeRawText) {
    const deviationOpts: DeviationOptions = {
      includeRawText: true,
      ...(signal ? { signal } : {}),
      ...(registry ? { registry } : {}),
    };
    try {
      semantic = await detectSemanticDeviations(text, analysisProfile, deviationOpts);
    } catch (err) {
      // Caller cancellation is non-retryable per ADR-0011 and must surface
      // to the caller so Stage 21 and the UI can distinguish cancel from
      // success. Only transient provider failures are logged and skipped.
      if (signal?.aborted) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("Semantic consistency check failed; continuing without semantic findings", {
        error: message,
      });
      semanticStatus = { status: "degraded", error: message };
    }
  }

  const findings = unifyFindings({ deterministic, formatting, semantic });

  return buildReport(findings, profile.id, docHash ?? hashText(text), semanticStatus, coverage);
}
