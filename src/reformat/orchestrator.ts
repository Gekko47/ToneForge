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
import { isStale } from "../changes/staleGuard";
import {
  applyChangePlanWithTracking,
  STAGE_01_PASSED,
  type ApplyWithTrackingResult,
} from "../word/revisionAdapter";
import {
  getDocumentSnapshot,
  getStructuredSnapshot,
  hashDocument,
  type DocumentSnapshot,
} from "../word/documentReader";
import { getFormattingSnapshot } from "../word/formattingReader";
import { type FormattingSnapshot } from "../formatting/formattingSnapshot";
import type { StyleProfile } from "../core/domain/StyleProfile";
import type { ChangePlan } from "../core/domain/ChangePlan";
import type { LlmProvider, LlmSemanticProvider } from "../ai/providers/LlmProvider";
import type { DocumentSnapshot as StructuredDocumentSnapshot } from "../core/domain/DocumentSnapshot";
import type { GovernanceProfile } from "../core/domain/GovernanceProfile";
import {
  reviewEntireDocument as runDocumentEditorialReview,
  type FullReviewResult,
} from "../ai/review/documentEditorialReview";

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
  /**
   * Stage 22 safety flag. Conflicting plans are refused by default; set this
   * only when the caller has explicitly reviewed the conflict list and
   * acknowledged that applying may produce contradictory edits.
   */
  allowConflictingApply?: boolean;
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
    allowConflictingApply = false,
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

  // Stage 22: stale plans never enter the mutation adapter. The adapter guard
  // remains defense-in-depth, but the orchestrator already knows the plan is
  // doomed, so it refuses here with a preview-shaped outcome.
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

  // Stage 22: conflicting plans are refused unless the caller explicitly
  // acknowledges the risk via allowConflictingApply. This is a safety gate,
  // not a resolution step — the conflict list is preserved on the plan for
  // the caller to review.
  if (plan.conflicts.length > 0 && !allowConflictingApply) {
    return {
      report,
      plan,
      results: plan.changes.map((change) => ({
        changeId: change.id,
        applied: false,
        error: `ChangePlan has ${plan.conflicts.length} unresolved conflict(s); review before applying`,
      })),
      tracking: { managed: false },
      snapshot,
      stale: plan.stale,
      applied: false,
    };
  }

  // Stage 22: re-hash the live document immediately before mutation. The
  // caller-supplied currentDocHash is advisory; the orchestrator re-reads the
  // document so a user edit between preview and apply cannot silently
  // corrupt the plan. Abort is propagated through the re-read.
  const liveSnapshot = await getDocumentSnapshot({ maxChars: readLimit });
  const liveHash = liveSnapshot.hash ?? hashDocument(liveSnapshot.text);
  if (isStale(plan, liveHash)) {
    return {
      report,
      plan,
      results: [],
      tracking: { managed: false },
      snapshot,
      stale: true,
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

  const liveStructured = await getStructuredSnapshot({ maxChars: readLimit });
  const applyResult = await applyChangePlanWithTracking(
    plan,
    liveHash,
    allowConflictingApply,
    liveStructured.nodes,
  );
  const verificationSnapshot = await getDocumentSnapshot({ maxChars: readLimit });
  const verificationHash = verificationSnapshot.hash ?? hashDocument(verificationSnapshot.text);
  const allApplied =
    applyResult.results.length > 0 && applyResult.results.every((result) => result.applied);
  if (allApplied && verificationHash === liveHash) {
    return {
      report,
      plan,
      results: applyResult.results.map((result) => ({
        ...result,
        applied: false,
        error: "Post-apply verification found no document change.",
      })),
      tracking: applyResult.tracking,
      snapshot,
      stale: false,
      applied: false,
    };
  }

  return {
    report,
    plan,
    results: applyResult.results,
    tracking: applyResult.tracking,
    snapshot,
    stale: plan.stale,
    applied: allApplied,
  };
}

export interface ApplyReviewedPlanOptions {
  plan: ChangePlan;
  allowConflictingApply?: boolean;
  maxChars?: number;
}

export interface ApplyReviewedPlanResult {
  results: ApplyWithTrackingResult["results"];
  tracking: ApplyWithTrackingResult["tracking"];
  stale: boolean;
  applied: boolean;
}

/** Apply a previously reviewed plan after a fresh structured protection check. */
export async function applyReviewedPlan(
  options: ApplyReviewedPlanOptions,
): Promise<ApplyReviewedPlanResult> {
  const live = await getStructuredSnapshot(
    options.maxChars === undefined ? {} : { maxChars: options.maxChars },
  );
  if (isStale(options.plan, live.contentHash)) {
    return {
      results: options.plan.changes.map((change) => ({
        changeId: change.id,
        applied: false,
        error: "Reviewed plan is stale; preview again before applying.",
      })),
      tracking: { managed: false },
      stale: true,
      applied: false,
    };
  }
  const result = await applyChangePlanWithTracking(
    options.plan,
    live.contentHash,
    options.allowConflictingApply ?? false,
    live.nodes,
  );
  const allApplied = result.results.length > 0 && result.results.every((item) => item.applied);
  return { ...result, stale: false, applied: allApplied };
}

export interface FullDocumentReviewOptions {
  profile: GovernanceProfile;
  includeRawText: true;
  registry: LlmProvider;
  snapshot?: StructuredDocumentSnapshot;
  currentDocumentVersion?: string;
  signal?: AbortSignal;
  getCurrentDocumentHash?: () => Promise<string>;
  onProgress?: (completed: number, total: number) => void;
}

/** Run the coverage-first, bounded full-document review without mutating Word. */
export async function reviewEntireDocument(
  options: FullDocumentReviewOptions,
): Promise<FullReviewResult> {
  const snapshot = options.snapshot ?? (await getStructuredSnapshot());
  return runDocumentEditorialReview({
    snapshot,
    profile: options.profile,
    includeRawText: options.includeRawText,
    registry: options.registry,
    ...(options.currentDocumentVersion !== undefined
      ? { currentDocumentVersion: options.currentDocumentVersion }
      : {}),
    getCurrentDocumentHash:
      options.getCurrentDocumentHash ??
      (async () => hashDocument((await getDocumentSnapshot()).text)),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
}
