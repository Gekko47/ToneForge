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
import { logger } from "../shared/utils/logger";
import { FindingSchema } from "../core/domain/Finding";
import type { Finding } from "../core/domain/Finding";
import { StyleProfileSchema } from "../core/domain/StyleProfile";
import type { StyleProfile } from "../core/domain/StyleProfile";
import type { DeviationOptions } from "./deviationEngine";
import type { LlmSemanticProvider } from "../ai/providers/LlmProvider";

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
});

export type ConsistencyReport = z.infer<typeof ConsistencyReportSchema>;

export interface CheckConsistencyOptions {
  text: string;
  profile: StyleProfile;
  snapshot?: FormattingSnapshot;
  docHash?: string;
  includeRawText?: boolean;
  signal?: AbortSignal;
  /** Injected semantic provider; tests use MockAdapter only. */
  registry?: LlmSemanticProvider;
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

function buildReport(findings: Finding[], profileId: string, docHash: string): ConsistencyReport {
  return ConsistencyReportSchema.parse({
    findings,
    summary: summarize(findings),
    profileId,
    docHash,
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
  const { text, docHash, includeRawText = false, signal, registry } = options;

  // Parse inputs at the boundary so malformed profile/snapshot fail fast
  // with typed Zod errors instead of throwing deep inside engines.
  const profile = StyleProfileSchema.parse(options.profile);
  const snapshot = options.snapshot ? FormattingSnapshotSchema.parse(options.snapshot) : undefined;

  if (text.trim().length === 0) {
    return buildReport([], profile.id, docHash ?? hashText(text));
  }

  const deterministic: Finding[] = [];
  deterministic.push(...findTypographyIssues({ text, rules: profile.typography }));
  deterministic.push(...findHouseStyleIssues({ text, rules: profile.houseStyle }));

  const formatting: Finding[] = snapshot ? findFormattingIssues({ snapshot, profile }) : [];

  let semantic: Finding[] = [];
  if (includeRawText) {
    const deviationOpts: DeviationOptions = {
      includeRawText: true,
      ...(signal ? { signal } : {}),
      ...(registry ? { registry } : {}),
    };
    try {
      semantic = await detectSemanticDeviations(text, profile, deviationOpts);
    } catch (err) {
      // Caller cancellation is non-retryable per ADR-0011 and must surface
      // to the caller so Stage 21 and the UI can distinguish cancel from
      // success. Only transient provider failures are logged and skipped.
      if (signal?.aborted) {
        throw err;
      }
      logger.warn("Semantic consistency check failed; continuing without semantic findings", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const findings = unifyFindings({ deterministic, formatting, semantic });

  return buildReport(findings, profile.id, docHash ?? hashText(text));
}
