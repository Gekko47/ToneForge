/**
 * Applying a semantic rewrite. Its own path, deliberately.
 *
 * **This is not the deterministic flow.** A semantic rewrite is one paragraph
 * the user selected and one paragraph the model proposed, shown side by side,
 * with two controls: apply it, or ask again. It does not go through
 * `planChanges`, the review gate, the reviewed-only projection, or the Pending
 * Changes section, because none of those can address it: the deterministic
 * gate resolves a finding against a deterministic plan, and a semantic
 * proposal is not in one. Routing it through them produced a button that
 * reported "the planner proposes no correction for this finding" on a finding
 * that did have one — a dead end with no way to use or refine the rewrite.
 *
 * **It does share the mutation path.** ADR-0005 admits exactly one writer:
 * `applyChangePlan`, and only the Word boundary may call it. So this module
 * builds the single change a rewrite needs, wraps it in a plan, and hands that
 * to the same `applyReviewedPlan` the deterministic flow uses. Sharing the
 * writer is a requirement, not a similarity; what is kept apart is the review
 * experience, which is where the two flows genuinely differ.
 *
 * The change it builds is deliberately narrow:
 *
 * - `replaceText` over the verified range the rewrite engine anchored, not a
 *   recomputed one. The engine resolved that range against the acquired nodes
 *   and refused anything it could not; recomputing it here would discard the
 *   one check that makes an AI-supplied offset safe to use.
 * - An exact text precondition carrying the original paragraph. The adapter
 *   refuses the write if the document moved underneath, which is the failure
 *   mode that matters: the user edits the paragraph, comes back, presses
 *   Apply, and a stale offset rewrites the wrong span.
 * - `approvalState: "approved"`, because the user pressed Apply. The approval
 *   requirement is not removed — it is what the button is.
 * - No conflicts, and no governance rules. There is one change, so there is
 *   nothing to conflict with, and governance policy governs the deterministic
 *   rule set rather than an individual author's paragraph.
 * **Two contracts live here, and one of them is a countdown.** `applyApprovedSemanticRevision`
 * and `buildSemanticRevisionChange` take an `ApprovedSemanticRevision` and never see a
 * `Finding`. `applySemanticRewrite` and `buildSemanticRewriteChange` take a `Finding`,
 * because `Semantic.tsx` still calls them; they are deleted in P7 with the page, in the
 * same commit, and nothing new is written against them.
 */

import { v4 as uuidv4 } from "uuid";
import { ChangeSchema, type Change, type ChangeRange } from "../core/domain/Change";
import { createChangePlan, type ChangePlan } from "../core/domain/ChangePlan";
import type { Finding } from "../core/domain/Finding";
import type { SemanticSelectionAnchor } from "../core/domain/SemanticReviewSession";
import { wordParagraphNodeId, type DocumentNode } from "../core/domain/DocumentSnapshot";
import {
  validatePreservation,
  type PreservationReport,
} from "../analysis/semantic/preservationValidator";
import {
  PARTIAL_SELECTION_REFUSAL,
  resolveWholeParagraphIndex,
  supportsRangedReplacement,
} from "../word/rangeResolution";
import { getStructuredSnapshot } from "../word/documentReader";
import { logger } from "../shared/utils/logger";
import { applyReviewedPlan, type ApplyReviewedPlanResult } from "./orchestrator";

/**
 * What the user approved, and what it was approved against.
 *
 * **No `Finding`, by decision (D4).** The old contract took one, and the adapter's
 * protection and preservation checks both read `Finding` fields — so a change with no
 * `findingId` skipped both, and a finding with no `nodeIds` or no `actual` skipped them
 * too. Those checks failed open by omission rather than by decision. The new contract
 * carries everything the checks need on the `Change` itself, and this object carries
 * only what the *user* approved: the exact text they saw, the text the model proposed,
 * and the anchor the two were captured against.
 */
export interface ApprovedSemanticRevision {
  /** The selected text, exactly as captured. Becomes the change's precondition. */
  original: string;
  /** The text the model proposed and the user approved. */
  revised: string;
  /** Where the selection was, from `word/selectionScope`. */
  anchor: SemanticSelectionAnchor;
  /**
   * Whether the selection was exactly one paragraph, mark included or not.
   *
   * Decides the write path: a whole paragraph is written through
   * `Paragraph.getRange("Whole")`, which every Word host has, while a partial range
   * needs `Range.set` and Word on the web does not.
   */
  coversWholeParagraph: boolean;
  /** Why the revision is worth making — the assessment's summary, not the model's. */
  rationale: string;
  /** False when a gate refused. The refusal is returned, not thrown. */
  actionable: boolean;
  /** The user's sentence for a non-actionable revision. */
  refusalReason?: string;
}

export interface SemanticRevisionApplyOptions {
  revision: ApprovedSemanticRevision;
  /** Optional cap on the document read used to resolve the target. */
  maxChars?: number;
}

export interface SemanticRevisionApplyResult extends ApplyReviewedPlanResult {
  /** The plan that was written, or the empty plan a refusal produced. */
  plan: ChangePlan;
  /** Why nothing was written, or `null` when it was. */
  refusal: string | null;
  /** The preservation report as it stood at write time, for the pane to show. */
  preservation: PreservationReport;
}

/**
 * Build the one change an approved semantic revision is.
 *
 * The range, the unit and the precondition all come from what was captured and
 * approved — nothing is recomputed from the document, because recomputing would
 * discard the one thing that makes a captured offset safe to use.
 *
 * Exported for testing: the shape of this change is the whole of the
 * semantic-specific behaviour, and a test that asserts the range, the unit, the
 * precondition and the approval state is the only way to know they came from the
 * approval rather than from a guess.
 */
export function buildSemanticRevisionChange(
  revision: ApprovedSemanticRevision,
  target: { range: ChangeRange; index?: number; nodeId?: string },
): Change {
  return ChangeSchema.parse({
    id: uuidv4(),
    type: "replaceText",
    range: target.range,
    payload: { text: revision.revised },
    rationale: revision.rationale,
    /*
     * The precondition has to match the unit.
     *
     * A character-unit write is verified against the text at those offsets, so it
     * carries a `text` precondition. A paragraph-unit write is verified against
     * the paragraph itself, so it carries a `node` precondition naming the node
     * the host gave us — built with `wordParagraphNodeId`, because the anchor
     * holds the raw `uniqueLocalId` and the adapter compares node ids. Both carry
     * `expectedText`, so the adapter's preservation check reads the same text
     * either way and a paragraph write cannot slip past it.
     */
    precondition:
      target.range.unit === "paragraph" && target.nodeId !== undefined
        ? { kind: "node", nodeId: target.nodeId, expectedText: revision.original }
        : { kind: "text", expectedText: revision.original },
    approvalRequired: true,
    // The user pressed Apply. The requirement stands; this is its satisfaction.
    approvalState: "approved",
    source: "ai",
    reversible: true,
    risk: "medium",
  });
}

/**
 * Write an approved semantic revision, as a tracked change.
 *
 * Order matters and is the point of this function:
 *
 * 1. **Preservation is re-run here, not trusted from the proposal.** The report the
 *    user saw described the text they reviewed; the text is re-compared now because
 *    "the user approved it" and "it is still safe" are different claims, and the second
 *    is the one that touches the document. This is the *pre-write* layer; the adapter's
 *    own check is an independent *at-write* backstop and is deliberately left in place.
 * 2. **The target is resolved before the write, not discovered during it.** A whole
 *    paragraph goes through the paragraph path every host supports; a partial range
 *    needs `Range.set`, and a host without it is refused with the remedy rather than
 *    allowed to throw a host exception mid-apply.
 * 3. **The plan carries no `Finding`.** `plan.findings` stays absent, which is what
 *    makes this a live test of D4: the adapter's two checks have to work from the
 *    `Change` alone.
 */
export async function applyApprovedSemanticRevision(
  options: SemanticRevisionApplyOptions,
): Promise<SemanticRevisionApplyResult> {
  const { revision } = options;

  // Refused before any read: a revision the gates already refused costs nothing to
  // refuse again, and the empty plan says plainly that nothing was attempted.
  if (!revision.actionable) {
    const preservation = validatePreservation(revision.original, revision.revised);
    return {
      ...emptyResult(revision.anchor.documentId, revision.refusalReason ?? NOT_ACTIONABLE),
      preservation,
    };
  }

  const preservation = validatePreservation(revision.original, revision.revised);
  if (!preservation.pass) {
    // The first *hard* warning, not the first warning: a soft one is allowed to
    // ride along with a refusal the user has already been shown.
    const sentence =
      preservation.warnings.find((warning) => warning.tier === "hard")?.message ??
      preservation.summary ??
      HARD_PRESERVATION_REFUSAL;
    logger.warn("Semantic revision refused before the write", {
      refusalCategory: "local_precondition_failed",
      verificationResult: "refused",
      hardFailureCount: preservation.warnings.filter((warning) => warning.tier === "hard").length,
    });
    return { ...emptyResult(revision.anchor.documentId, sentence), preservation };
  }

  const snapshot = await getStructuredSnapshot(
    options.maxChars === undefined ? {} : { maxChars: options.maxChars },
  );
  const resolved = await resolveTarget(revision, snapshot.nodes);
  if (!resolved.ok) {
    return {
      ...emptyResult(revision.anchor.documentId, resolved.refusal),
      preservation,
    };
  }

  const change = buildSemanticRevisionChange(revision, resolved);
  // Schema version 2, because the change carries the exact precondition the version
  // requires. A version 1 plan would parse and then be refused by the adapter, which
  // reads as a host problem rather than as a missing contract.
  const plan = createChangePlan(snapshot.contentHash, revision.anchor.documentId, [change], [], {
    schemaVersion: 2,
    documentId: revision.anchor.documentId,
    contentHash: snapshot.contentHash,
    structuralHash: snapshot.structuralHash,
  });

  const result = await applyReviewedPlan({
    plan,
    ...(options.maxChars === undefined ? {} : { maxChars: options.maxChars }),
  });

  return {
    ...result,
    plan,
    preservation,
    refusal: result.verified
      ? null
      : (result.verificationError ??
        "The revision was not written. Nothing has been changed in the document."),
  };
}

/**
 * D11's three-step fallback, resolved before the write.
 *
 * Whole paragraph first, because it is the only path that works on every host.
 * Character range second, because it is what a partial selection needs. Stated
 * refusal third, because "this Word cannot do that" is something the user can act
 * on and a discovered host exception is not.
 */
async function resolveTarget(
  revision: ApprovedSemanticRevision,
  nodes: readonly DocumentNode[],
): Promise<
  { ok: true; range: ChangeRange; index?: number; nodeId?: string } | { ok: false; refusal: string }
> {
  const { anchor } = revision;
  // The anchor's ids are the host's raw `uniqueLocalId`s; a `ChangeTarget` and a
  // node precondition both name a document *node*, so the id is built rather than
  // copied — by the one function that states the relationship.
  const nodeId =
    anchor.nodeIds.length > 0 ? wordParagraphNodeId(anchor.nodeIds[0] as string) : undefined;
  if (revision.coversWholeParagraph) {
    const index = resolveWholeParagraphIndex(anchor, nodes);
    if (index !== null) {
      return {
        ok: true,
        index,
        ...(nodeId === undefined ? {} : { nodeId }),
        range: {
          start: index,
          end: index + 1,
          unit: "paragraph",
          target: { kind: "paragraph", index, ...(nodeId === undefined ? {} : { nodeId }) },
        },
      };
    }
    // A whole-paragraph claim the snapshot cannot corroborate is not trusted: it
    // falls through to the character path, which is checked against the host.
  }
  if (!(await supportsRangedReplacement())) {
    return { ok: false, refusal: PARTIAL_SELECTION_REFUSAL };
  }
  return {
    ok: true,
    ...(nodeId === undefined ? {} : { nodeId }),
    range: {
      start: anchor.startOffset,
      end: anchor.endOffset,
      unit: "character",
      ...(nodeId === undefined ? {} : { target: { kind: "paragraph" as const, index: 0, nodeId } }),
    },
  };
}

/**
 * The result of a refusal: no plan, no attempt, and a stated reason.
 *
 * The counts are zero rather than failures because nothing was attempted — a
 * revision refused before the adapter is not a change the adapter failed to write,
 * and rendering it as one would blame the writer for a decision made upstream.
 */
function emptyResult(
  documentId: string,
  refusal: string,
): ApplyReviewedPlanResult & {
  plan: ChangePlan;
  refusal: string;
} {
  return {
    plan: createChangePlan("unapplied", documentId, [], [], { schemaVersion: 2 }),
    results: [],
    tracking: { managed: false },
    stale: false,
    applied: false,
    verified: false,
    outcome: {
      changes: [],
      verifiedCount: 0,
      unverifiedCount: 0,
      failedCount: 0,
      remainingFindings: null,
    },
    refusal,
  };
}

const NOT_ACTIONABLE =
  "This revision cannot be applied. Review the selection again to produce another.";
const HARD_PRESERVATION_REFUSAL =
  "This revision changes something the local check protects, so it cannot be applied. Regenerate the review; nothing has been changed.";

// ---------------------------------------------------------------------------
// Legacy contract. Deleted in P7, with `Semantic.tsx`, in the same commit.
// ---------------------------------------------------------------------------

export interface SemanticRewriteApplyOptions {
  /**
   * The proposal, as returned by `proposeSemanticRewrite`.
   *
   * Must be `actionable`. The engine sets that only when the anchor resolved
   * *and* the model was confident enough, and the caller is expected to have
   * hidden the control otherwise — this is the second refusal, not the first.
   */
  finding: Finding;
  /** The document this rewrite was made against, re-checked before writing. */
  documentId: string;
  /** The hash observed now; a mismatch means the document moved. */
  currentDocHash: string;
  maxChars?: number;
}

export interface SemanticRewriteApplyResult extends ApplyReviewedPlanResult {
  /** The plan that was written, for the caller to show or export. */
  plan: ChangePlan;
  /**
   * Why the rewrite was not written, or `null` when it was.
   *
   * A refusal the user cannot act on is the defect this module exists to fix,
   * so the reason is returned rather than logged and swallowed.
   */
  refusal: string | null;
}

/**
 * Build the one change a semantic rewrite is.
 *
 * Exported for testing rather than for reuse: it is the whole of the
 * semantic-specific behaviour, and a test that asserts the shape of the change
 * is the only way to know the range and the precondition came from the verified
 * proposal rather than from something recomputed.
 */
export function buildSemanticRewriteChange(finding: Finding): Change {
  const original = finding.actual ?? finding.evidence;
  const rewritten = finding.expected;
  if (original === undefined || rewritten === undefined) {
    throw new Error(
      "This proposal carries no text to replace, so it cannot be applied. Nothing has been changed.",
    );
  }
  const nodeId = finding.nodeIds[0];
  return ChangeSchema.parse({
    id: uuidv4(),
    type: "replaceText",
    /*
     * The target rides inside the range, not beside it.
     *
     * `ChangeRangeSchema` carries an optional `target` and `ChangeSchema` has no
     * such field, so a top-level `target` is not a value the parser rejects —
     * it is a key it strips. The node the engine anchored to would silently
     * never reach the plan, and the write would fall back to offsets alone,
     * which is the one thing the anchor check exists to avoid.
     */
    range: {
      start: finding.range.start,
      end: finding.range.end,
      unit: "character",
      ...(nodeId === undefined ? {} : { target: { kind: "paragraph" as const, index: 0, nodeId } }),
    },
    payload: { text: rewritten },
    rationale: finding.explanation ?? finding.message,
    // The exact span the engine verified. Without this the adapter has nothing
    // to compare against and would write into a paragraph that has since
    // changed.
    precondition: { kind: "text", expectedText: original },
    approvalRequired: true,
    // The user pressed Apply. The requirement stands; this is its satisfaction.
    approvalState: "approved",
    findingId: finding.id,
    reversible: true,
    risk: "medium",
  });
}

/**
 * Write one proposed paragraph into the document, as a tracked change.
 *
 * Returns rather than throws on a refusal, so the tab can say what happened in
 * the same sentence the user can act on. An unexpected throw still propagates:
 * a bug is not a refusal.
 */
export async function applySemanticRewrite(
  options: SemanticRewriteApplyOptions,
): Promise<SemanticRewriteApplyResult> {
  const { finding } = options;
  if (!finding.actionable) {
    return {
      plan: createChangePlan(options.currentDocHash, options.documentId, []),
      results: [],
      // `managed: false` because nothing was written: the adapter was never
      // entered, so no tracking mode was read or controlled.
      tracking: { managed: false },
      stale: false,
      applied: false,
      verified: false,
      // The same result block the deterministic path reports, with zero counts
      // rather than four failures: the plan was never built, so nothing was
      // attempted. A semantic rewrite that cannot be applied is a *refusal*, and
      // rendering it as a failed change would blame the adapter for a decision
      // this function made before reaching it.
      outcome: {
        changes: [],
        verifiedCount: 0,
        unverifiedCount: 0,
        failedCount: 0,
        remainingFindings: null,
      },
      refusal:
        finding.advisoryReason ??
        "This rewrite cannot be applied. Regenerate the review to ask for another.",
    };
  }

  const change = buildSemanticRewriteChange(finding);
  // Schema version 2, because the change carries the exact precondition the
  // version requires. A version 1 plan would parse and then be refused by the
  // adapter, which reads as a host problem rather than as a missing contract.
  const plan = createChangePlan(options.currentDocHash, options.documentId, [change], [finding], {
    schemaVersion: 2,
    documentId: options.documentId,
    contentHash: options.currentDocHash,
  });

  const result = await applyReviewedPlan({
    plan,
    ...(options.maxChars === undefined ? {} : { maxChars: options.maxChars }),
  });

  return {
    ...result,
    plan,
    refusal: result.verified
      ? null
      : (result.verificationError ??
        "The rewrite was not written. Nothing has been changed in the document."),
  };
}
