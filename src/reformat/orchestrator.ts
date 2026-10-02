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

import {
  runDeterministicReview,
  type DeterministicReviewReport,
} from "../analysis/deterministic/deterministicReviewEngine";
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
import { type StyleProfile } from "../core/domain/StyleProfile";
import { describeError } from "../shared/utils/logger";
import { createGovernanceProfile, type GovernanceProfile } from "../core/domain/GovernanceProfile";
import { resolveResolvedPolicy } from "../core/domain/ResolvedPolicy";
import type { Change } from "../core/domain/Change";
import type { ChangePlan } from "../core/domain/ChangePlan";
import type { DocumentSnapshot as StructuredDocumentSnapshot } from "../core/domain/DocumentSnapshot";
import { prepareTrackedEditing } from "./trackedEditing";

export interface ReformatOptions {
  profile: StyleProfile;
  policy?: GovernanceProfile;
  capabilities?: AnalysisCapabilities;
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
  report: DeterministicReviewReport;
  /**
   * The shared coverage report, for the coverage banner, the export path and
   * the Troubleshooting diagnostics.
   *
   * Separate from `report.coverage` on purpose. The deterministic projection's
   * `complete` means "every requested scope was examined"; this one's means "no
   * unexpected processing gap". A single field named `complete` answering two
   * questions is how a coverage banner ends up agreeing with an Apply gate that
   * disagrees with it.
   */
  sharedCoverage: ReturnType<typeof buildCoverage>;
  plan: ChangePlan;
  results: ApplyWithTrackingResult["results"];
  tracking: ApplyWithTrackingResult["tracking"];
  snapshot: StructuredDocumentSnapshot;
  stale: boolean;
  /** True only when every planned change was applied and verified. */
  applied: boolean;
  verified: boolean;
  verificationError?: string;
  /**
   * Spec §19's result block. Present on every path, including the ones that
   * applied nothing: a refused apply has a result too, and its counts are how
   * the UI says "0 of 4" rather than rendering nothing at all.
   */
  outcome: ApplyOutcome;
}

export interface ApplyReviewedPlanResult {
  results: ApplyWithTrackingResult["results"];
  tracking: ApplyWithTrackingResult["tracking"];
  stale: boolean;
  applied: boolean;
  verified: boolean;
  verificationError?: string;
  /** Spec §19's result block. See `ReformatResult.outcome`. */
  outcome: ApplyOutcome;
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
  supportsRangedReplacement: false,
  supportsParagraphResolution: false,
  supportsHighlight: false,
  supportsContextMenuApi: false,
  supportsTables: false,
  supportsHeadersFooters: false,
  supportsSections: false,
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
 * is propagated. The capability gate is enforced by the orchestrator pre-entry
 * and, at apply time, by `prepareTrackedEditing`; the adapter check remains
 * defense-in-depth. That preparation is the only caller of `setStage01Passed`
 * (ADR-0058).
 */
export async function reformatDocument(options: ReformatOptions): Promise<ReformatResult> {
  const { profile, maxChars, preview = false, currentDocHash } = options;
  const readLimit = maxChars ?? DEFAULT_MAX_CHARS;
  const policy: GovernanceProfile = options.policy ?? createGovernanceProfile(profile);
  const resolvedPolicy = resolveResolvedPolicy(profile, policy);
  /*
   * The same capability set the whole run was planned under.
   *
   * Named once rather than read from `options` at each use, because the
   * post-apply refresh has to run under the *same* capabilities as the review
   * that produced the plan. A refresh under a different set would compare the
   * document against a standard the apply was never gated on, and its report
   * would not be evidence about this document.
   */
  const capabilities = options.capabilities ?? FALLBACK_CAPABILITIES;

  // Step 1: Acquire one immutable scope for analysis. The legacy formatting
  // override remains supported for callers that already own a verified DTO.
  const context = await acquireAnalysisContext({
    profile,
    capabilities,
    policy,
    maxChars: readLimit,
  });
  const snapshot = context.snapshot;
  const formatting = options.formattingSnapshot ?? context.formatting;
  const docHash = context.identity.contentHash;

  // Step 2: Analyze. Every engine consumes the same identity, text, nodes, and
  // formatting DTO; the acquisition service is the only analysis read.
  const report = await runDeterministicReview({
    context: { ...context, formatting },
    resolvedPolicy,
  });

  // Step 3: Plan. The author's rules ride along so a rule can withhold a
  // change, raise its approval requirement, and be cited in Pending Changes —
  // otherwise `rules` is a field the plan cites a revision for but never reads.
  const plan = planChanges({
    findings: report.findings,
    docHash,
    baseDocId: context.identity.documentId,
    governanceRules: resolvedPolicy.rules,
    governancePolicyRevision: resolvedPolicy.governance.version,
    currentDocHash: currentDocHash ?? docHash,
    documentId: context.identity.documentId,
    documentVersion: context.identity.documentVersion,
    structuralHash: context.identity.structuralHash,
    analysisText: context.identity.analysisText,
    analysisStart: context.identity.analysisStart,
    analysisEnd: context.identity.analysisEnd,
    analysisTruncated: context.identity.analysisTruncated,
    profileId: profile.id,
    profileRevision: profile.revision,
  });
  const plannedCoverage = withCoverageCounts({ ...context, formatting }, plan.changes.length, 0);

  // Step 4: Preview or apply. Preview never enters the mutation adapter.
  if (preview || plan.changes.length === 0) {
    return {
      context,
      report,
      sharedCoverage: plannedCoverage,
      plan,
      results: [],
      tracking: { managed: false },
      snapshot,
      stale: plan.stale ?? false,
      applied: false,
      verified: false,
      // A preview has nothing to report on. `noAttemptOutcome` and
      // `refusedOutcome` differ here on purpose: a refused apply failed four
      // changes, a preview attempted none, and rendering both as four failures
      // would misstate what happened.
      outcome: noAttemptOutcome(plan, "Preview only; no change was applied."),
    };
  }

  // Stage 22: stale plans never enter the mutation adapter. The adapter guard
  // remains defense-in-depth, but the orchestrator already knows the plan is
  // doomed, so it refuses here with a preview-shaped outcome.
  if (plan.stale) {
    return {
      context,
      report,
      sharedCoverage: plannedCoverage,
      plan,
      results: [],
      tracking: { managed: false },
      snapshot,
      stale: plan.stale,
      applied: false,
      verified: false,
      outcome: noAttemptOutcome(plan, "The plan is stale; preview again before applying."),
    };
  }

  // Production application is fail-closed for unresolved conflicts. A preview
  // remains available so the user can inspect the conflict list, but the
  // mutation path never accepts a risk acknowledgement.
  if ((plan.conflicts ?? []).length > 0) {
    return {
      context,
      report,
      sharedCoverage: plannedCoverage,
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
      outcome: refusedOutcome(
        plan.changes.map((change) => ({
          changeId: change.id,
          applied: false,
          error: `ChangePlan has ${(plan.conflicts ?? []).length} unresolved conflict(s); review before applying`,
        })),
        "The plan has unresolved conflicts.",
      ),
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
      sharedCoverage: plannedCoverage,
      plan,
      results: [],
      tracking: { managed: false },
      snapshot,
      stale: true,
      applied: false,
      verified: false,
      outcome: noAttemptOutcome(plan, "The document changed after preview; nothing was applied."),
    };
  }

  const editingPreparation = await prepareTrackedEditing(plan.changes);
  if (editingPreparation.error) {
    return {
      context,
      report,
      sharedCoverage: plannedCoverage,
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
      outcome: refusedOutcome(
        plan.changes.map((change) => ({
          changeId: change.id,
          applied: false,
          error: editingPreparation.error ?? "Tracked editing is unavailable; mutation blocked.",
        })),
        editingPreparation.error ?? "Tracked editing is unavailable; no changes were applied.",
      ),
    };
  }

  const liveStructured = await getStructuredSnapshot({ maxChars: readLimit });
  const applyResult = await applyChangePlanWithTracking(
    plan,
    liveHash,
    false,
    liveStructured.nodes,
    resolvedPolicy.governance.version,
    // The same policy that planned the changes, so the protection check at
    // apply time reads the author's overrides rather than a type list.
    resolvedPolicy.governance,
  );
  const verificationSnapshot = await getDocumentSnapshot({ maxChars: readLimit });
  const verificationHash =
    verificationSnapshot.fullDocumentHash ??
    hashDocument(verificationSnapshot.fullText ?? verificationSnapshot.text);
  const allApplied =
    applyResult.results.length > 0 && applyResult.results.every((result) => result.applied);
  const appliedCoverage = withCoverageCounts(
    { ...context, formatting },
    plan.changes.length,
    allApplied ? applyResult.results.length : 0,
  );
  if (!applyResult.tracking.managed) {
    return {
      context,
      report,
      sharedCoverage: appliedCoverage,
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
      outcome: refusedOutcome(
        plan.changes.map((change) => ({ changeId: change.id, applied: false, error: "" })),
        "Managed Track Changes could not be established; no changes were applied.",
      ),
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
      sharedCoverage: appliedCoverage,
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
      outcome: refusedOutcome(
        applyResult.results,
        "Post-apply verification found no document change.",
      ),
    };
  }

  /*
   * The success path still reads back, and still refreshes.
   *
   * The hash comparison above proves the *document* moved. It says nothing
   * about whether each change landed as intended — a text change can move the
   * hash and still be the wrong replacement — and nothing at all about whether
   * the document now matches the profile. Spec §19 asks for all three, so this
   * path runs the same per-change readback and the same fresh review as the
   * reviewed-apply path does, and reports one `ApplyOutcome` either way.
   */
  const readback = await verifyPlanReadback(plan, readLimit);
  const remaining = allApplied
    ? await refreshRemainingFindings(profile, resolvedPolicy.governance, capabilities, readLimit)
    : { report: null as DeterministicReviewReport | null };
  /*
   * Reconcile the readback against what the adapter actually did.
   *
   * `verifyPlanReadback` answers "does the document now hold what this change
   * asked for", and a change the adapter refused can pass that test by accident:
   * a protected paragraph that already matched the requested style is unchanged
   * *and* correct, so the readback confirmed a write that never happened. The
   * per-change entries are therefore matched to `applyResult.results` by id, and a
   * refused change is reported unverified with the adapter's own reason.
   */
  const applyByChangeId = new Map(applyResult.results.map((item) => [item.changeId, item]));
  const reconciled = readback.changes.map((entry) => {
    const applied = applyByChangeId.get(entry.changeId);
    if (applied === undefined || applied.applied) return entry;
    return {
      changeId: entry.changeId,
      verified: false,
      error:
        applied.error === undefined || applied.error.length === 0
          ? "Change was not applied, so the readback does not describe it."
          : applied.error,
    };
  });
  const verifiedCount = reconciled.filter((entry) => entry.verified).length;
  const failedCount = applyResult.results.filter((item) => !item.applied).length;

  return {
    context,
    report,
    sharedCoverage: appliedCoverage,
    plan,
    results: applyResult.results,
    tracking: applyResult.tracking,
    snapshot,
    stale: plan.stale ?? false,
    applied: allApplied,
    verified: readback.verified,
    ...(readback.error === undefined ? {} : { verificationError: readback.error }),
    outcome: {
      changes: reconciled,
      verifiedCount,
      // Both counts are subtracted: a refused change is neither verified nor
      // written, and leaving it in the unverified column counted one change twice.
      unverifiedCount: Math.max(0, reconciled.length - verifiedCount - failedCount),
      failedCount,
      remainingFindings: remaining.report,
      ...(remaining.error === undefined ? {} : { remainingFindingsError: remaining.error }),
    },
  };
}

/**
 * The shared coverage report, with the plan's own counts folded in.
 *
 * Kept off the deterministic report. That report carries a
 * `DeterministicCoverage` projection whose `complete` means "every requested
 * scope was examined", and the shared report's `complete` means "no
 * unexpected processing gap". Attaching one to the other would mean a field
 * named `complete` answering two different questions depending on which object
 * a caller picked up — and the Apply gate reads it.
 *
 * So the two stay separate objects on the result, each answering its own
 * question, and the pane is given both.
 */
function withCoverageCounts(
  context: AnalysisContext,
  plannedChangeCount: number,
  appliedChangeCount: number,
) {
  return buildCoverage({
    nodes: context.nodes,
    text: context.text,
    acquisition: context.acquisition,
    plannedChangeCount,
    appliedChangeCount,
  });
}

export interface ApplyReviewedPlanOptions {
  plan: ChangePlan;
  /** Current persisted governance revision, required for governed plans. */
  currentGovernancePolicyRevision?: number;
  /**
   * The policy itself, when the caller has it.
   *
   * The revision number proves the plan was built under this policy; the policy
   * is what the protection check actually reads. Without it, apply falls back
   * to protecting everything by type, which is stricter than the author asked
   * for rather than looser — the failure direction that is safe, but which
   * would make a protection override silently stop working once someone routed
   * a plan through this path.
   */
  governanceProfile?: GovernanceProfile;
  coverage?: {
    complete: boolean;
    unsupported?: readonly string[];
    unprocessed?: readonly string[];
  } | null;
  /** Retained for compatibility; conflicts are always refused in production. */
  allowConflictingApply?: boolean;
  maxChars?: number;
  /**
   * The profile the plan was built from, for the post-apply refresh.
   *
   * Optional, and the outcome says so when it is absent: `remainingFindings`
   * comes back `null` with no error, because nothing was asked of the refresh
   * rather than because it failed. Spec §19 asks the report to show the
   * remaining deviations, and a report that silently showed none because the
   * caller forgot an argument would be the worst of the three answers.
   */
  profile?: StyleProfile;
  /** The capabilities the plan was built under, for the same refresh. */
  capabilities?: AnalysisCapabilities;
}

/**
 * The per-change outcome of the post-apply readback.
 *
 * Spec §19 asks for a result block, not a verdict. A boolean says "some change
 * did not take" and leaves the user to guess which — and the answer is usually
 * the one they care about, because a plan that half-applied is the case Track
 * Changes exists to make recoverable. So every change carries its own outcome,
 * and the counts are derived from those entries rather than counted separately,
 * which is what stops "3 of 4 applied" from disagreeing with a list of two.
 */
export interface ChangeVerification {
  changeId: string;
  verified: boolean;
  /** The user's words. Empty when verified, never absent when not. */
  error: string;
}

/**
 * Everything spec §19's result block states, in one place.
 *
 * `remainingFindings` is the fresh review of the document *after* the apply. It
 * is not derivable from the entries above: a change can be written, verified and
 * still leave the finding standing, because the correction was narrower than the
 * finding. Reporting only the verification would then say "all good" about a
 * document that still does not match the profile — which is the one thing a
 * post-apply report must not do.
 */
export interface ApplyOutcome {
  /** One entry per planned change, in plan order. */
  changes: ChangeVerification[];
  verifiedCount: number;
  /** Changes that were written but not confirmed by the readback. */
  unverifiedCount: number;
  /** Changes the adapter refused or that never reached it. */
  failedCount: number;
  /**
   * The review of the document as it now stands.
   *
   * `null` when the refresh could not run — a host that has gone away, or a
   * read that threw. Not an empty list: "we could not look" and "there is
   * nothing left" are different answers, and only the second one is good news.
   */
  remainingFindings: DeterministicReviewReport | null;
  /** Why the refresh could not run, when it could not. */
  remainingFindingsError?: string;
}

/**
 * The outcome for a path that wrote nothing.
 *
 * Every refusal still produces a result, and every change in it is *failed* with
 * the reason, rather than absent. A caller that renders `0 of 4 applied` and a
 * caller that renders nothing are reporting the same event, and only the first
 * is one a user can act on.
 */
function refusedOutcome(results: ApplyWithTrackingResult["results"], reason: string): ApplyOutcome {
  const changes = results.map((item) => ({
    changeId: item.changeId,
    verified: false,
    error: item.error === undefined || item.error.length === 0 ? reason : item.error,
  }));
  return {
    changes,
    verifiedCount: 0,
    /*
     * Nothing was written, so nothing can be unverified.
     *
     * `unverifiedCount` means "written but not confirmed by the readback". A refused
     * change was never written, and counting it in both columns made a plan of four
     * refusals report eight outcomes for four changes.
     */
    unverifiedCount: 0,
    failedCount: changes.length,
    remainingFindings: null,
  };
}

/**
 * The outcome for a path that wrote nothing *because there was nothing to do*.
 *
 * Distinct from `refusedOutcome` because the counts differ: a preview has
 * nothing to refuse, and reporting four failures for a plan that was never built
 * would be a lie about what happened.
 */
function noAttemptOutcome(plan: ChangePlan, reason: string): ApplyOutcome {
  return {
    changes: plan.changes.map((change) => ({
      changeId: change.id,
      verified: false,
      error: reason,
    })),
    verifiedCount: 0,
    unverifiedCount: 0,
    failedCount: 0,
    remainingFindings: null,
  };
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

/** Change types a formatting readback can confirm. */
const FORMATTING_CHANGE_TYPES = [
  "applyStyle",
  "resetCharacterFormatting",
  "setCharacterFormat",
  "setParagraphFormat",
  "setListLevel",
] as const;

/** Change types a document-hash readback can confirm. */
const TEXT_CHANGE_TYPES = ["insertText", "replaceText", "deleteRange"] as const;

/**
 * Re-read the document and confirm each planned change individually.
 *
 * The previous version returned on the *first* mismatch, so a plan of four with
 * one failure reported one error and the other three were simply absent from
 * the conversation. Spec §19 asks for per-change success and failure, and the
 * reason is practical rather than cosmetic: a partly-applied plan under Track
 * Changes is exactly the case the user needs itemised, because they have to
 * decide per change whether to keep or reject the revision.
 *
 * **Why the two readbacks stay separate.** A text change moves the document
 * hash and shifts every paragraph index after it, so a formatting comparison
 * against the same snapshot would be answering against stale offsets. A plan of
 * only text changes is therefore verified by hash alone, and a plan of only
 * formatting changes never consults the hash — a style applied to a paragraph
 * does not change the text, and treating "hash unchanged" as failure there would
 * report every style fix as unverified.
 *
 * `verified: true` for a change the readback cannot speak to is stated rather
 * than assumed: the `default` arm of `verifyFormattingChange` covers a type with
 * no readback rule, and a change that reached that arm is a change the adapter
 * applied and this module has no evidence against. The alternative — marking it
 * unverified — would report "unverified" on every change type this pass has not
 * yet been taught to check, which is a report nobody can act on.
 */
async function verifyPlanReadback(
  plan: ChangePlan,
  maxChars?: number,
): Promise<{ verified: boolean; changes: ChangeVerification[]; error?: string }> {
  const hasTextChange = plan.changes.some((change) =>
    (TEXT_CHANGE_TYPES as readonly string[]).includes(change.type),
  );
  if (hasTextChange) {
    const after = await getDocumentSnapshot(maxChars === undefined ? {} : { maxChars });
    const moved =
      (after.fullDocumentHash ?? hashDocument(after.fullText ?? after.text)) !== plan.docHash;
    return {
      verified: moved,
      changes: plan.changes.map((change) => ({
        changeId: change.id,
        verified: moved,
        error: moved ? "" : "Readback did not show the planned text change.",
      })),
      ...(moved ? {} : { error: "Readback did not show the planned text change." }),
    };
  }

  const formattingChanges = plan.changes.filter((change) =>
    (FORMATTING_CHANGE_TYPES as readonly string[]).includes(change.type),
  );
  if (formattingChanges.length === 0) {
    return {
      verified: true,
      changes: plan.changes.map((change) => ({ changeId: change.id, verified: true, error: "" })),
    };
  }

  const after = await getFormattingSnapshot(maxChars === undefined ? {} : { maxChars });
  const changes: ChangeVerification[] = plan.changes.map((change) => {
    if (!(FORMATTING_CHANGE_TYPES as readonly string[]).includes(change.type)) {
      return { changeId: change.id, verified: true, error: "" };
    }
    const readback = verifyFormattingChange(change, after);
    return { changeId: change.id, verified: readback.verified, error: readback.error };
  });
  const firstFailure = changes.find((entry) => !entry.verified);
  return {
    verified: firstFailure === undefined,
    changes,
    ...(firstFailure === undefined ? {} : { error: firstFailure.error }),
  };
}

/**
 * Re-run the deterministic review over the document as it now stands.
 *
 * Spec §19's "remaining deviations". It is a *fresh* review rather than a
 * subtraction from the pre-apply list, because a correction can produce a
 * finding the original did not have: applying a style to a paragraph can leave
 * it out of compliance with a paragraph standard the style was not configured
 * for. Subtracting would have reported a clean document.
 *
 * A failure here is a fact, not an exception: the apply already happened, and
 * reporting "we could not check" is the honest outcome. Swallowing it would let
 * a vanished host read as a clean document.
 */
async function refreshRemainingFindings(
  profile: StyleProfile,
  policy: GovernanceProfile,
  capabilities: AnalysisCapabilities,
  maxChars?: number,
): Promise<{ report: DeterministicReviewReport | null; error?: string }> {
  try {
    const context = await acquireAnalysisContext({
      profile,
      capabilities,
      policy,
      ...(maxChars === undefined ? {} : { maxChars }),
    });
    return { report: await runDeterministicReview({ context }) };
  } catch (error: unknown) {
    return {
      report: null,
      error: `The document could not be re-read after Apply: ${describeError(error).errorMessage ?? "unknown error"}`,
    };
  }
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
      outcome: refusedOutcome(
        options.plan.changes.map((change) => ({
          changeId: change.id,
          applied: false,
          error: "Reviewed plan is not schema version 2; preview again before applying.",
        })),
        "Incompatible ChangePlan schema is refused.",
      ),
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
      outcome: refusedOutcome(
        options.plan.changes.map((change) => ({
          changeId: change.id,
          applied: false,
          error: "Reviewed plan coverage is incomplete; no changes were applied.",
        })),
        "Incomplete coverage blocks reviewed apply.",
      ),
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
      outcome: refusedOutcome(
        options.plan.changes.map((change) => ({
          changeId: change.id,
          applied: false,
          error:
            editingPreparation.error ?? "Tracked editing is unavailable; no changes were applied.",
        })),
        editingPreparation.error ?? "Tracked editing is unavailable; no changes were applied.",
      ),
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
      outcome: noAttemptOutcome(
        options.plan,
        "The document changed after preview; nothing was applied.",
      ),
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
      outcome: refusedOutcome(
        options.plan.changes.map((change) => ({
          changeId: change.id,
          applied: false,
          error: "The plan contains unresolved conflicts; regenerate the preview before applying.",
        })),
        "Unresolved conflicts block application.",
      ),
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
    ...(options.governanceProfile === undefined ? [] : [options.governanceProfile]),
  );
  const allApplied = result.results.length > 0 && result.results.every((item) => item.applied);
  if (!result.tracking.managed) {
    /*
     * The adapter's own per-change reason is kept where it has one.
     *
     * This branch conflates two refusals: a host that could not establish
     * managed tracking, and a plan the adapter refused on its own merits — a
     * protected paragraph, a dropped preserved literal. Replacing both with the
     * tracking sentence reported "Managed Track Changes is required" for a
     * protection refusal, which sends the user to Troubleshooting to fix a host
     * problem they do not have. ADR-0069 requires the refusal to name the cause
     * and the control that resolves it, and only the adapter knows which it was.
     */
    const trackingRefusal =
      "Managed Track Changes could not be established; no changes were applied.";
    const reasonFor = (item: { error?: string }): string =>
      item.error === undefined || item.error.length === 0 ? trackingRefusal : item.error;
    return {
      ...result,
      results: result.results.map((item) => ({
        changeId: item.changeId,
        applied: false,
        error: reasonFor(item),
      })),
      stale: false,
      applied: false,
      verified: false,
      verificationError:
        result.results[0] === undefined ? trackingRefusal : reasonFor(result.results[0]),
      outcome: refusedOutcome(result.results, trackingRefusal),
    };
  }
  if (!allApplied) {
    /*
     * A partly-applied plan is the case Track Changes exists to make
     * recoverable, so it is reported in full rather than as a single error.
     * The counts come from the same `results` array the caller already has, so
     * the per-change list and the summary cannot disagree.
     */
    return {
      ...result,
      stale: false,
      applied: false,
      verified: false,
      verificationError:
        result.results.find((item) => !item.applied)?.error ?? "One or more changes failed.",
      outcome: {
        changes: result.results.map((item) => ({
          changeId: item.changeId,
          verified: false,
          error:
            item.error === undefined || item.error.length === 0
              ? item.applied
                ? "Change was written but not verified."
                : "Change was not applied."
              : item.error,
        })),
        verifiedCount: 0,
        /*
         * The two counts partition the plan rather than overlap.
         *
         * `unverifiedCount` is "written but not confirmed"; a change the adapter
         * refused was never written, so counting it in both columns reported eight
         * outcomes for a four-change plan of which two landed.
         */
        unverifiedCount: result.results.filter((item) => item.applied).length,
        failedCount: result.results.filter((item) => !item.applied).length,
        remainingFindings: null,
      },
    };
  }
  const readback = await verifyPlanReadback(options.plan, options.maxChars);
  /*
   * The remaining-findings refresh, on the reviewed path as on the preview one.
   *
   * It needs the same three inputs the review itself did, so `applyReviewedPlan`
   * takes them rather than re-deriving them: the refresh runs the *same* engine
   * under the *same* policy, and a report produced under different conditions
   * than the one that planned the fix is not evidence about this document.
   */
  const remaining =
    options.profile === undefined
      ? { report: null as DeterministicReviewReport | null }
      : await refreshRemainingFindings(
          options.profile,
          options.governanceProfile ?? createGovernanceProfile(options.profile),
          options.capabilities ?? FALLBACK_CAPABILITIES,
          options.maxChars,
        );
  const verifiedCount = readback.changes.filter((entry) => entry.verified).length;
  return {
    ...result,
    stale: false,
    applied: readback.verified,
    verified: readback.verified,
    ...(readback.error === undefined ? {} : { verificationError: readback.error }),
    outcome: {
      changes: readback.changes,
      verifiedCount,
      unverifiedCount: readback.changes.length - verifiedCount,
      failedCount: 0,
      remainingFindings: remaining.report,
      ...(remaining.error === undefined ? {} : { remainingFindingsError: remaining.error }),
    },
  };
}
