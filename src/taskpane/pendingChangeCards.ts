/**
 * The Pending Changes card model (spec §17).
 *
 * **Why a model and not a component.** The five-column table this replaces put
 * `Change type`, `Before`, `After`, `Risk`, `Source`, `Approval` and
 * `Precondition` side by side in a 320px task pane, which left every cell about
 * one word wide; the wrapper scrolled horizontally to compensate. The cards are
 * a different *shape*, not a different arrangement of the same table, and the
 * judgement about what belongs on a card — which of the seven fields earns its
 * place, and what a location label may honestly claim — is worth testing without
 * a DOM.
 *
 * **A location label states what was acquired.** The spec's example reads
 * "Paragraph 14", and that is the better label where it is available. It is not
 * available for a text correction: acquisition flattens the body into a bounded
 * text window, so a character offset has no paragraph index to convert to, and
 * deriving one from the finding's node id would produce a number that does not
 * match the document. Those cards say "Character N" instead. A precise label
 * pointing at the wrong place is worse than a coarse one pointing at the right
 * place, and "Character 4,120" is genuinely where the change will land.
 */

import type { Change, ChangeRange } from "../core/domain/Change";
import type { ChangePlan } from "../core/domain/ChangePlan";
import type { Finding } from "../core/domain/Finding";

/** One change as the card presents it. */
export interface PendingChangeCard {
  changeId: string;
  /** The finding that produced it, when the run that built the plan is supplied. */
  finding: Finding | undefined;
  /** "House terminology · Low risk" — the rule in words, then the risk. */
  heading: string;
  /** Where it lands, in the units the change actually addresses. */
  location: string;
  /** The text as it is now, or `null` when the plan carries none. */
  before: string | null;
  /** The text it will be, or `null` when there is none. */
  after: string | null;
  /** The approval state, in the user's words. */
  approval: string;
  /** False when the change has no precondition, which is what Apply refuses on. */
  preconditionHeld: boolean;
  /** Whether "Go to text" has a finding to navigate to. */
  canNavigate: boolean;
}

/**
 * Build the cards for a plan, in the order the plan lists them.
 *
 * Order is the plan's rather than the document's: the plan is what Apply will
 * write, in the order it will write it, and a card list reordered for reading
 * would not match what happens.
 */
export function buildPendingChangeCards(
  plan: ChangePlan | null,
  findings: readonly Finding[],
): PendingChangeCard[] {
  if (plan === null) return [];
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  return plan.changes.map((change) => {
    const finding = change.findingId === undefined ? undefined : byId.get(change.findingId);
    return {
      changeId: change.id,
      finding,
      heading: `${ruleLabel(change, finding)} · ${riskLabel(change)}`,
      location: locationLabel(change.range),
      before: finding?.actual ?? null,
      after: finding?.expected ?? replacementOf(change),
      approval: approvalLabel(change),
      preconditionHeld: change.precondition !== undefined,
      canNavigate: finding !== undefined,
    };
  });
}

/**
 * The rule, in words a reader recognises.
 *
 * The finding's category is the user-facing name of the rule, and the spec's
 * example ("House terminology", "Heading 2") is that name rather than an
 * internal id. The change type is the fallback for a plan whose findings were
 * not supplied, and it is a worse answer — `replaceText` names the mechanism,
 * not the problem — so it reads as the absence of a finding rather than
 * pretending to be a rule.
 */
function ruleLabel(change: Change, finding: Finding | undefined): string {
  return finding?.category ?? change.ruleId ?? change.type;
}

/**
 * The risk, capitalised for a heading.
 *
 * `undefined` is rendered as "risk unavailable" rather than omitted: a card
 * that silently drops the field teaches the reader that ToneForge assessed the
 * risk when it did not.
 */
function riskLabel(change: Change): string {
  if (change.risk === undefined) return "risk unavailable";
  return `${change.risk} risk`;
}

/** Where the change lands, in the unit the change addresses. */
function locationLabel(range: ChangeRange): string {
  // Paragraph and section are counted from 1 because that is how a reader
  // counts them; a character offset is an index and is shown as one.
  if (range.unit === "paragraph") return `Paragraph ${range.start + 1}`;
  if (range.unit === "section") return `Section ${range.start + 1}`;
  return `Character ${range.start}`;
}

/** The approval state, in words rather than the enum value. */
function approvalLabel(change: Change): string {
  if (change.approvalState === undefined) return "Approval state unavailable";
  if (change.approvalRequired !== true) return "Approved";
  switch (change.approvalState) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "pending":
      return "Awaiting approval";
    default:
      return "Approval not required";
  }
}

/**
 * The replacement text a change carries, when the plan has no finding for it.
 *
 * A `replaceText` or `insertText` change states its own result, so a card can
 * show the "after" without the finding that produced it. Every other type has no
 * such text — a style application is named by the style, not a string — and
 * returns `null` so the card omits the row rather than printing "undefined".
 */
function replacementOf(change: Change): string | null {
  if (change.type !== "replaceText" && change.type !== "insertText") return null;
  const text = change.payload.text;
  return typeof text === "string" ? text : null;
}

/** The sticky footer's counts, so they cannot disagree with the cards. */
export interface PendingChangeTotals {
  /** Changes in the cards, which are the ones Apply would write. */
  approved: number;
  /** Changes the preview proposed that the user has not reviewed. */
  awaitingReview: number;
}

/**
 * The two counts the footer states.
 *
 * `awaitingReview` is `totalCount - approved` rather than a recount: the parent
 * owns the number the preview proposed, and a second count computed here is a
 * second thing that can disagree with the header above it. The arithmetic cannot
 * go negative — a caller cannot have reviewed more than was proposed, and a
 * negative count rendered as "−3 awaiting review" would be a lie either way.
 */
export function pendingChangeTotals(approved: number, totalProposed: number): PendingChangeTotals {
  return {
    approved,
    awaitingReview: Math.max(0, totalProposed - approved),
  };
}
