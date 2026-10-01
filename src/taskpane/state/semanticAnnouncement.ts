/**
 * The one sentence the semantic pages speak.
 *
 * Moved out of `pages/Semantic.tsx` when that page was split in two, because a
 * derived function that both pages need is neither page's. It stays pure and stays
 * testable on its own, which is the property the original was written for: the
 * priority order is the whole of the behaviour, and a priority order asserted
 * through rendered components is one that only fails when a component changes.
 *
 * ADR-0062: one live region per pane, with an explicit priority. An error outranks
 * a success, because the user pressed a button that did not do what it said and
 * that is the more urgent thing to hear.
 */

/** The message a page speaks, and whether it is an interruption. */
export interface SemanticAnnouncement {
  text: string;
  assertive: boolean;
}

export interface SemanticAnnouncementInput {
  /** A completed action, in the user's terms. */
  status: string | null;
  /** Anything that went wrong. Outranks every status. */
  error: string | null;
  /** The selection currently held, for the "what am I reviewing" case. */
  selection: string | null;
}

/**
 * Which outcome should be spoken, or nothing at all.
 *
 * `null` rather than an empty string, so the caller can leave its region alone
 * rather than re-announcing a blank sentence every render.
 */
export function deriveSemanticAnnouncement(
  input: SemanticAnnouncementInput,
): SemanticAnnouncement | null {
  if (input.error !== null && input.error.length > 0) {
    return { text: input.error, assertive: true };
  }
  if (input.status !== null && input.status.length > 0) {
    return { text: input.status, assertive: false };
  }
  if (input.selection !== null && input.selection.length > 0) {
    return { text: `Selection read: ${input.selection}`, assertive: false };
  }
  return null;
}
