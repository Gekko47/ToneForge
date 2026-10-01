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
 */

import { v4 as uuidv4 } from "uuid";
import { ChangeSchema, type Change } from "../core/domain/Change";
import { createChangePlan, type ChangePlan } from "../core/domain/ChangePlan";
import type { Finding } from "../core/domain/Finding";
import { applyReviewedPlan, type ApplyReviewedPlanResult } from "./orchestrator";

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
