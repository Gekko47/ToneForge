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
import { buildCoverage } from "../analysis/coverage";
import { acquireAnalysisContext } from "../word/analysisAcquisition";
import type { AnalysisContext } from "../analysis/analysisContext";
import { planChanges } from "../changes/planner";
import { isStale } from "../changes/staleGuard";
import { applyChangePlanWithTracking, type ApplyWithTrackingResult } from "../word/revisionAdapter";
import { probeWordCapabilities, type WordCapabilities } from "../word/capabilityProbe";
import type { AnalysisCapabilities } from "../analysis/analysisContext";
import { getDocumentSnapshot, getStructuredSnapshot, hashDocument } from "../word/documentReader";
import { getFormattingSnapshot } from "../word/formattingReader";
import { type FormattingSnapshot } from "../formatting/formattingSnapshot";
import { formatProfileVersion, type StyleProfile } from "../core/domain/StyleProfile";
import type { Change } from "../core/domain/Change";
import type { ChangePlan } from "../core/domain/ChangePlan";
import type { LlmProvider, LlmSemanticProvider } from "../ai/providers/LlmProvider";
import type { DocumentSnapshot as StructuredDocumentSnapshot } from "../core/domain/DocumentSnapshot";
import type { GovernanceProfile } from "../core/domain/GovernanceProfile";
import {
  reviewEntireDocument as runDocumentEditorialReview,
  type FullReviewResult,
} from "../ai/review/documentEditorialReview";
import { prepareTrackedEditing } from "./trackedEditing";

export interface ReformatOptions {
  profile: StyleProfile;
  policy?: GovernanceProfile;
  capabilities?: AnalysisCapabilities;
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
  context: AnalysisContext;
  report: ConsistencyReport;
  plan: ChangePlan;
  results: ApplyWithTrackingResult["results"];
  tracking: ApplyWithTrackingResult["tracking"];
  snapshot: StructuredDocumentSnapshot;
  stale: boolean;
  /** True only when every planned change was applied and verified. */
  applied: boolean;
  verified: boolean;
  verificationError?: string;
}

export interface ApplyReviewedPlanResult {
  results: ApplyWithTrackingResult["results"];
  tracking: ApplyWithTrackingResult["tracking"];
  stale: boolean;
  applied: boolean;
  verified: boolean;
  verificationError?: string;
}

/** Inspect the non-destructive host probe without arming the mutation adapter. */
export async function prepareReformatHost(): Promise<WordCapabilities> {
  return probeWordCapabilities();
}

const DEFAULT_MAX_CHARS = 500_000;

const FALLBACK_CAPABILITIES = {
  supportsInsertText: false,
  supportsReplaceText: false,
  supportsInsertParagraph: false,
  supportsInsertBreak: false,
  supportsStyles: false,
  supportsParagraphFormat: false,
  supportsCharacterFormat: false,
  supportsResetCharacterFormatting: false,
  supportsListLevel: false,
  supportsRevisions: false,
  supportsSelection: false,
  supportsParagraphResolution: false,
  supportsHighlight: false,
  supportsContextMenu: false,
  hostName: "unknown" as const,
  hostVersion: null,
};

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
    maxChars,
    preview = false,
    currentDocHash,
  } = options;
  const readLimit = maxChars ?? DEFAULT_MAX_CHARS;

  // Step 1: Acquire one immutable scope for analysis. The legacy formatting
  // override remains supported for callers that already own a verified DTO.
  const context = await acquireAnalysisContext({
    profile,
    capabilities: options.capabilities ?? FALLBACK_CAPABILITIES,
    ...(options.policy ? { policy: options.policy } : {}),
    maxChars: readLimit,
  });
  const snapshot = context.snapshot;
  const formatting = options.formattingSnapshot ?? context.formatting;
  const docHash = context.identity.contentHash;

  // Step 2: Analyze. Every engine consumes the same identity, text, nodes, and
  // formatting DTO; the acquisition service is the only analysis read.
  let report = await checkConsistency({
    context: { ...context, formatting },
    includeRawText,
    ...(signal ? { signal } : {}),
    ...(registry ? { registry } : {}),
  });

  // Step 3: Plan
  const plan = planChanges({
    findings: report.findings,
    docHash,
    baseDocId: context.identity.documentId,
    ...(options.policy ? { governancePolicyRevision: options.policy.version } : {}),
    currentDocHash: currentDocHash ?? docHash,
    documentId: context.identity.documentId,
    documentVersion: context.identity.documentVersion,
    structuralHash: context.identity.structuralHash,
    analysisText: context.identity.analysisText,
    analysisStart: context.identity.analysisStart,
    analysisEnd: context.identity.analysisEnd,
    analysisTruncated: context.identity.analysisTruncated,
    profileId: profile.id,
    profileVersion: formatProfileVersion(profile.version),
  });
  report = withCoverageCounts(report, { ...context, formatting }, plan.changes.length, 0);

  // Step 4: Preview or apply. Preview never enters the mutation adapter.
  if (preview || plan.changes.length === 0) {
    return {
      context,
      report,
      plan,
      results: [],
      tracking: { managed: false },
      snapshot,
      stale: plan.stale ?? false,
      applied: false,
      verified: false,
    };
  }

  // Stage 22: stale plans never enter the mutation adapter. The adapter guard
  // remains defense-in-depth, but the orchestrator already knows the plan is
  // doomed, so it refuses here with a preview-shaped outcome.
  if (plan.stale) {
    return {
      context,
      report,
      plan,
      results: [],
      tracking: { managed: false },
      snapshot,
      stale: plan.stale,
      applied: false,
      verified: false,
    };
  }

  // Production application is fail-closed for unresolved conflicts. A preview
  // remains available so the user can inspect the conflict list, but the
  // mutation path never accepts a risk acknowledgement.
  if ((plan.conflicts ?? []).length > 0) {
    return {
      context,
      report,
      plan,
      results: plan.changes.map((change) => ({
        changeId: change.id,
        applied: false,
        error: `ChangePlan has ${(plan.conflicts ?? []).length} unresolved conflict(s); review before applying`,
      })),
      tracking: { managed: false },
      snapshot,
      stale: plan.stale ?? false,
      applied: false,
      verified: false,
    };
  }

  // Stage 22: re-hash the live document immediately before mutation. The
  // caller-supplied currentDocHash is advisory; the orchestrator re-reads the
  // document so a user edit between preview and apply cannot silently
  // corrupt the plan. Abort is propagated through the re-read.
  const liveSnapshot = await getDocumentSnapshot({ maxChars: readLimit });
  const liveHash =
    liveSnapshot.fullDocumentHash ?? hashDocument(liveSnapshot.fullText ?? liveSnapshot.text);
  if (isStale(plan, liveHash)) {
    return {
      context,
      report,
      plan,
      results: [],
      tracking: { managed: false },
      snapshot,
      stale: true,
      applied: false,
      verified: false,
    };
  }

  const editingPreparation = await prepareTrackedEditing(plan.changes);
  if (editingPreparation.error) {
    return {
      context,
      report,
      plan,
      results: plan.changes.map((change) => ({
        changeId: change.id,
        applied: false,
        error: editingPreparation.error ?? "Tracked editing is unavailable; mutation blocked.",
      })),
      tracking: { managed: false },
      snapshot,
      stale: plan.stale ?? false,
      applied: false,
      verified: false,
      verificationError: editingPreparation.error ?? undefined,
    };
  }

  const liveStructured = await getStructuredSnapshot({ maxChars: readLimit });
  const applyResult = await applyChangePlanWithTracking(
    plan,
    liveHash,
    false,
    liveStructured.nodes,
    options.policy?.version,
  );
  const verificationSnapshot = await getDocumentSnapshot({ maxChars: readLimit });
  const verificationHash =
    verificationSnapshot.fullDocumentHash ??
    hashDocument(verificationSnapshot.fullText ?? verificationSnapshot.text);
  const allApplied =
    applyResult.results.length > 0 && applyResult.results.every((result) => result.applied);
  report = withCoverageCounts(
    report,
    { ...context, formatting },
    plan.changes.length,
    allApplied ? applyResult.results.length : 0,
  );
  if (!applyResult.tracking.managed) {
    return {
      context,
      report,
      plan,
      results: applyResult.results.map((result) => ({
        changeId: result.changeId,
        applied: false,
        error: "Managed Track Changes could not be established; no changes were applied.",
      })),
      tracking: applyResult.tracking,
      snapshot,
      stale: false,
      applied: false,
      verified: false,
      verificationError: "Managed Track Changes is required.",
    };
  }
  if (
    allApplied &&
    verificationHash === liveHash &&
    plan.changes.some((change) =>
      ["insertText", "replaceText", "deleteRange"].includes(change.type),
    )
  ) {
    return {
      context,
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
      verified: false,
      verificationError: "Post-apply verification found no document change.",
    };
  }

  return {
    context,
    report,
    plan,
    results: applyResult.results,
    tracking: applyResult.tracking,
    snapshot,
    stale: plan.stale ?? false,
    applied: allApplied,
    verified: allApplied,
  };
}

function withCoverageCounts(
  report: ConsistencyReport,
  context: AnalysisContext,
  plannedChangeCount: number,
  appliedChangeCount: number,
): ConsistencyReport {
  return {
    ...report,
    coverage: buildCoverage({
      nodes: context.nodes,
      text: context.text,
      acquisition: context.acquisition,
      plannedChangeCount,
      appliedChangeCount,
    }),
  };
}

export interface ApplyReviewedPlanOptions {
  plan: ChangePlan;
  /** Current persisted governance revision, required for governed plans. */
  currentGovernancePolicyRevision?: number;
  coverage?: {
    complete: boolean;
    unsupported?: readonly string[];
    unprocessed?: readonly string[];
  } | null;
  /** Retained for compatibility; conflicts are always refused in production. */
  allowConflictingApply?: boolean;
  maxChars?: number;
}

interface PlanReadback {
  verified: boolean;
  error?: string;
}

function paragraphAt(
  after: FormattingSnapshot,
  change: Change,
): FormattingSnapshot["paragraphs"][number] | undefined {
  const expectedNodeId =
    change.precondition?.kind === "node" ? change.precondition.nodeId : undefined;
  return after.paragraphs.find((paragraph) =>
    expectedNodeId === undefined
      ? paragraph.index === change.range.start
      : paragraph.nodeId === expectedNodeId,
  );
}

function verifyFormattingChange(
  change: Change,
  after: FormattingSnapshot,
): { verified: boolean; error: string } {
  const paragraph = paragraphAt(after, change);
  if (paragraph === undefined) {
    return { verified: false, error: "Formatting readback did not contain the target paragraph." };
  }

  switch (change.type) {
    case "applyStyle":
      return paragraph.styleName === change.payload.styleName
        ? { verified: true, error: "" }
        : {
            verified: false,
            error: `Readback expected style "${String(change.payload.styleName)}" but found "${paragraph.styleName}".`,
          };
    case "resetCharacterFormatting":
      return paragraph.fontName === null &&
        paragraph.fontSize === null &&
        paragraph.fontColor === null &&
        paragraph.bold !== true &&
        paragraph.italic !== true &&
        paragraph.underline !== true
        ? { verified: true, error: "" }
        : { verified: false, error: "Readback still contains direct character formatting." };
    case "setCharacterFormat": {
      const payload = change.payload as {
        name?: string;
        size?: number;
        color?: string;
        bold?: boolean;
        italic?: boolean;
        underline?: boolean;
      };
      const matches =
        (payload.name === undefined || paragraph.fontName === payload.name) &&
        (payload.size === undefined || paragraph.fontSize === payload.size) &&
        (payload.color === undefined || paragraph.fontColor === payload.color) &&
        (payload.bold === undefined || paragraph.bold === payload.bold) &&
        (payload.italic === undefined || paragraph.italic === payload.italic) &&
        (payload.underline === undefined || paragraph.underline === payload.underline);
      return matches
        ? { verified: true, error: "" }
        : { verified: false, error: "Readback did not match the requested character formatting." };
    }
    case "setParagraphFormat": {
      const payload = change.payload as {
        alignment?: "left" | "center" | "right" | "justified";
        lineSpacing?: number;
        spaceAfter?: number;
        spaceBefore?: number;
        listLevel?: number;
      };
      const matches =
        (payload.alignment === undefined || paragraph.alignment === payload.alignment) &&
        (payload.lineSpacing === undefined || paragraph.lineSpacing === payload.lineSpacing) &&
        (payload.spaceAfter === undefined || paragraph.spaceAfter === payload.spaceAfter) &&
        (payload.spaceBefore === undefined || paragraph.spaceBefore === payload.spaceBefore) &&
        (payload.listLevel === undefined || paragraph.listLevel === payload.listLevel);
      return matches
        ? { verified: true, error: "" }
        : { verified: false, error: "Readback did not match the requested paragraph formatting." };
    }
    case "setListLevel":
      return paragraph.listLevel === change.payload.level
        ? { verified: true, error: "" }
        : {
            verified: false,
            error: `Readback expected list level ${String(change.payload.level)} but found ${String(paragraph.listLevel)}.`,
          };
    default:
      return { verified: true, error: "" };
  }
}

async function verifyPlanReadback(plan: ChangePlan, maxChars?: number): Promise<PlanReadback> {
  const hasTextChange = plan.changes.some((change) =>
    ["insertText", "replaceText", "deleteRange"].includes(change.type),
  );
  if (hasTextChange) {
    const after = await getDocumentSnapshot(maxChars === undefined ? {} : { maxChars });
    return (after.fullDocumentHash ?? hashDocument(after.fullText ?? after.text)) !== plan.docHash
      ? { verified: true }
      : { verified: false, error: "Readback did not show the planned text change." };
  }

  const formattingChanges = plan.changes.filter((change) =>
    [
      "applyStyle",
      "resetCharacterFormatting",
      "setCharacterFormat",
      "setParagraphFormat",
      "setListLevel",
    ].includes(change.type),
  );
  if (formattingChanges.length === 0) return { verified: true };

  const after = await getFormattingSnapshot(maxChars === undefined ? {} : { maxChars });
  for (const change of formattingChanges) {
    const readback = verifyFormattingChange(change, after);
    if (!readback.verified) return readback;
  }
  return { verified: true };
}

/** Apply a previously reviewed plan after a fresh structured protection check. */
export async function applyReviewedPlan(
  options: ApplyReviewedPlanOptions,
): Promise<ApplyReviewedPlanResult> {
  if (options.plan.schemaVersion !== 2) {
    return {
      results: options.plan.changes.map((change) => ({
        changeId: change.id,
        applied: false,
        error: "Reviewed plan is not schema version 2; preview again before applying.",
      })),
      tracking: { managed: false },
      stale: false,
      applied: false,
      verified: false,
      verificationError: "Incompatible ChangePlan schema is refused.",
    };
  }
  if (
    options.coverage !== undefined &&
    options.coverage !== null &&
    options.coverage.complete !== true
  ) {
    return {
      results: options.plan.changes.map((change) => ({
        changeId: change.id,
        applied: false,
        error: "Reviewed plan coverage is incomplete; no changes were applied.",
      })),
      tracking: { managed: false },
      stale: false,
      applied: false,
      verified: false,
      verificationError: "Incomplete coverage blocks reviewed apply.",
    };
  }
  const editingPreparation = await prepareTrackedEditing(options.plan.changes);
  if (editingPreparation.error) {
    return {
      results: options.plan.changes.map((change) => ({
        changeId: change.id,
        applied: false,
        error:
          editingPreparation.error ?? "Tracked editing is unavailable; no changes were applied.",
      })),
      tracking: { managed: false },
      stale: false,
      applied: false,
      verified: false,
      verificationError: editingPreparation.error,
    };
  }

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
      verified: false,
      verificationError: "The document changed after preview.",
    };
  }
  if ((options.plan.conflicts ?? []).length > 0) {
    return {
      results: options.plan.changes.map((change) => ({
        changeId: change.id,
        applied: false,
        error: "The plan contains unresolved conflicts; regenerate the preview before applying.",
      })),
      tracking: { managed: false },
      stale: false,
      applied: false,
      verified: false,
      verificationError: "Unresolved conflicts block application.",
    };
  }
  const result = await applyChangePlanWithTracking(
    options.plan,
    live.contentHash,
    false,
    live.nodes,
    ...(options.currentGovernancePolicyRevision === undefined
      ? []
      : [options.currentGovernancePolicyRevision]),
  );
  const allApplied = result.results.length > 0 && result.results.every((item) => item.applied);
  if (!result.tracking.managed) {
    return {
      ...result,
      results: result.results.map((item) => ({
        changeId: item.changeId,
        applied: false,
        error: "Managed Track Changes could not be established; no changes were applied.",
      })),
      stale: false,
      applied: false,
      verified: false,
      verificationError: "Managed Track Changes is required.",
    };
  }
  if (!allApplied) {
    return {
      ...result,
      stale: false,
      applied: false,
      verified: false,
      verificationError:
        result.results.find((item) => !item.applied)?.error ?? "One or more changes failed.",
    };
  }
  const readback = await verifyPlanReadback(options.plan, options.maxChars);
  return {
    ...result,
    stale: false,
    applied: readback.verified,
    verified: readback.verified,
    ...(readback.error === undefined ? {} : { verificationError: readback.error }),
  };
}

export interface FullDocumentReviewOptions {
  profile: GovernanceProfile;
  includeRawText: true;
  consent: { fullDocumentReview: true };
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
    consent: options.consent,
    registry: options.registry,
    ...(options.currentDocumentVersion !== undefined
      ? { currentDocumentVersion: options.currentDocumentVersion }
      : {}),
    getCurrentDocumentHash:
      options.getCurrentDocumentHash ??
      (async () => {
        const current = await getDocumentSnapshot();
        const fullText = current.fullText ?? current.text;
        return current.fullDocumentHash ?? hashDocument(fullText);
      }),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
}
