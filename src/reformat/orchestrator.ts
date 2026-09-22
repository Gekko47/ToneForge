/**
 * Stage 21 — Reformat orchestrator.
 *
 * Drives the full reformat pipeline: snapshot → analyze → plan → apply.
 * Composes Stage 20 findings-only output with Stage 17 planning and Stage 18
 * tracked application into a single taskpane-safe entry point.
 *
 * Boundary rule: this module may import `core/domain`, `analysis`, `changes`,
 * `word/documentReader`, `word/formattingReader`, `word/revisionAdapter`,
 * `ai/providers`, and `shared/utils`. It must never import `taskpane` or
 * `commands`; `taskpane` must never import `word/revisionAdapter` directly.
 */

import { checkConsistency, type ConsistencyReport } from "../analysis/consistencyChecker";
import { planChanges } from "../changes/planner";
import {
  applyChangePlanWithTracking,
  STAGE_01_PASSED,
  type ApplyWithTrackingResult,
} from "../word/revisionAdapter";
import { getDocumentSnapshot, hashDocument, type DocumentSnapshot } from "../word/documentReader";
import { getFormattingSnapshot } from "../word/formattingReader";
import { type FormattingSnapshot } from "../formatting/formattingSnapshot";
import type { StyleProfile } from "../core/domain/StyleProfile";
import type { ChangePlan } from "../core/domain/ChangePlan";
import type { LlmSemanticProvider } from "../ai/providers/LlmProvider";

export interface ReformatOptions {
  profile: StyleProfile;
  includeRawText?: boolean;
  signal?: AbortSignal;
  /** Injected semantic provider; tests use MockAdapter only. */
  registry?: LlmSemanticProvider;
  /** Optional pre-built formatting snapshot; when absent the orchestrator reads one. */
  formattingSnapshot?: FormattingSnapshot;
  /** Optional max chars for snapshot reads. */
  maxChars?: number;
  /** Return the analyzed plan without entering the mutation adapter. */
  preview?: boolean;
  /**
   * Optional hash observed by the caller at apply time. When omitted, the
   * snapshot hash is reused for the immediate apply path.
   */
  currentDocHash?: string;
}

export interface ReformatResult {
  report: ConsistencyReport;
  plan: ChangePlan;
  results: ApplyWithTrackingResult["results"];
  tracking: ApplyWithTrackingResult["tracking"];
  snapshot: DocumentSnapshot;
  stale: boolean;
  /** True only when every planned change was applied. */
  applied: boolean;
}

const DEFAULT_MAX_CHARS = 500_000;

/**
 * Run the full reformat pipeline against the live Word document.
 *
 * 1. Snapshot: read document text and formatting via `runInWord`.
 * 2. Analyze: run the hybrid consistency checker (deterministic + formatting
 *    + optional semantic).
 * 3. Plan: convert findings into a conflict-aware ChangePlan.
 * 4. Apply: apply the plan through the tracked revision adapter.
 *
 * Empty text short-circuits to an empty report and plan with no apply step.
 * Provider failures are logged and skipped inside the checker; caller abort
 * is propagated. The Stage 01 capability gate is enforced by the orchestrator
 * pre-entry; the adapter check remains defense-in-depth.
 */
export async function reformatDocument(options: ReformatOptions): Promise<ReformatResult> {
  const {
    profile,
    includeRawText = false,
    signal,
    registry,
    formattingSnapshot: providedSnapshot,
    maxChars,
    preview = false,
    currentDocHash,
  } = options;
  const readLimit = maxChars ?? DEFAULT_MAX_CHARS;

  // Step 1: Snapshot
  const snapshot = await getDocumentSnapshot({ maxChars: readLimit });
  const text = snapshot.text;
  const docHash = snapshot.hash ?? hashDocument(text);

  // Step 2: Analyze. Empty documents cannot contain formatting findings, so
  // avoid an unnecessary second Word read before delegating to Stage 20.
  const report =
    text.trim().length === 0
      ? await checkConsistency({
          text,
          profile,
          docHash,
          includeRawText,
          ...(signal ? { signal } : {}),
          ...(registry ? { registry } : {}),
        })
      : await checkConsistency({
          text,
          profile,
          snapshot: providedSnapshot ?? (await getFormattingSnapshot({ maxChars: readLimit })),
          docHash,
          includeRawText,
          ...(signal ? { signal } : {}),
          ...(registry ? { registry } : {}),
        });

  // Step 3: Plan
  const plan = planChanges({
    findings: report.findings,
    docHash,
    baseDocId: snapshot.id,
    currentDocHash: currentDocHash ?? docHash,
  });

  // Step 4: Preview or apply. Preview never enters the mutation adapter.
  if (preview || plan.changes.length === 0) {
    return {
      report,
      plan,
      results: [],
      tracking: { managed: false },
      snapshot,
      stale: plan.stale,
      applied: false,
    };
  }

  // Stale plans never enter the mutation adapter. The adapter guard remains
  // defense-in-depth, but the orchestrator already knows the plan is doomed.
  if (plan.stale) {
    return {
      report,
      plan,
      results: [],
      tracking: { managed: false },
      snapshot,
      stale: plan.stale,
      applied: false,
    };
  }

  // Stage 01 gate pre-entry refusal. Snapshot/analyze/plan are read-only/pure,
  // so the mutation gate is enforced at exactly the boundary that matters.
  if (!STAGE_01_PASSED) {
    return {
      report,
      plan,
      results: plan.changes.map((change) => ({
        changeId: change.id,
        applied: false,
        error: "Stage 01 Office.js capability probe has not passed; mutation blocked",
      })),
      tracking: { managed: false },
      snapshot,
      stale: plan.stale,
      applied: false,
    };
  }

  const applyResult = await applyChangePlanWithTracking(plan, currentDocHash ?? docHash);

  return {
    report,
    plan,
    results: applyResult.results,
    tracking: applyResult.tracking,
    snapshot,
    stale: plan.stale,
    applied:
      applyResult.results.length > 0 && applyResult.results.every((result) => result.applied),
  };
}
