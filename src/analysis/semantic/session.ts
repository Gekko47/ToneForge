/**
 * Semantic review session lifecycle.
 *
 * **A proposal is only valid against the thing it was made from.** If the user
 * changes the selection, or edits the profile, the proposal on screen no longer
 * describes what Apply would do — and a button that stays enabled through that is
 * a button that writes something the user did not approve.
 *
 * So invalidation is a function of two inputs and nothing else: the anchor's
 * `selectionHash` and the profile revision. Both are cheap, both are already on
 * hand at the point of the check, and neither requires reading the document —
 * the adapter's exact `text` precondition covers staleness in the document
 * itself, and re-reading here would put a whole-document read on a path whose
 * whole purpose was to avoid one.
 *
 * **Invalidation returns a state, not a boolean.** A session that simply
 * disappeared would leave the user looking at a proposal that no longer means
 * anything, with nothing saying why. `stale` is nameable, and ADR-0069 requires
 * every refusal to name the control that resolves it — here, that control is
 * "Review the selection again".
 */

import {
  SemanticReviewSessionSchema,
  type SemanticReviewSession,
  type SemanticReviewState,
} from "../../core/domain/SemanticReviewSession";

/** What the caller knows at the moment it asks whether the session still holds. */
export interface SessionContext {
  readonly selectionHash: string;
  readonly profileId: string;
  readonly profileRevision: number;
}

export interface SemanticReviewOptions {
  provider: string;
  model: string;
  domain?: "general" | "constructionExpert";
}

/** A fresh session, before any provider has been called. */
export function createSemanticReviewSession(
  context: SessionContext,
  selection: SemanticReviewSession["selection"],
  options: SemanticReviewOptions,
  now: string,
  id: string,
): SemanticReviewSession {
  return SemanticReviewSessionSchema.parse({
    id,
    profileId: context.profileId,
    profileRevision: context.profileRevision,
    selection,
    provider: options.provider,
    model: options.model,
    startedAt: now,
    state: "ready",
  });
}

/**
 * Move a session to a new state, stamping the completion time on the first
 * arrival at a terminal state.
 *
 * Terminal rather than final, because `failed` can be retried and `stale` can be
 * refreshed — but both have finished the review they were part of, and the time
 * it finished is a fact worth keeping either way.
 */
const TERMINAL_STATES: ReadonlySet<SemanticReviewState> = new Set<SemanticReviewState>([
  "applied",
  "kept_original",
  "stale",
  "failed",
]);

export function advanceSession(
  session: SemanticReviewSession,
  state: SemanticReviewState,
  now: string,
): SemanticReviewSession {
  return {
    ...session,
    state,
    completedAt:
      TERMINAL_STATES.has(state) && session.completedAt === undefined ? now : session.completedAt,
  };
}

/**
 * Whether the session still describes what is on screen, and why not if it does
 * not.
 *
 * Both conditions are checked before either is reported, so a user whose
 * selection and profile both moved is told about the selection first — the more
 * visible of the two, and the one whose remedy is a single click.
 */
export function checkSessionFreshness(
  session: SemanticReviewSession,
  context: SessionContext,
): { fresh: true } | { fresh: false; reason: string } {
  if (session.selection.selectionHash !== context.selectionHash) {
    return {
      fresh: false,
      reason:
        "The selection has changed since this review was made. Review the selection again before applying.",
    };
  }
  if (
    session.profileId !== context.profileId ||
    session.profileRevision !== context.profileRevision
  ) {
    return {
      fresh: false,
      reason:
        "The active style profile has changed since this review was made. Review the selection again before applying.",
    };
  }
  return { fresh: true };
}

/**
 * The session as it should be shown right now, with staleness already applied.
 *
 * Returns a new session rather than a flag so a caller cannot show a proposal it
 * forgot to check — the freshness test and the object the pane renders are the
 * same value, which is what makes it hard to get wrong.
 */
export function currentSession(
  session: SemanticReviewSession,
  context: SessionContext,
  now: string,
): SemanticReviewSession {
  const freshness = checkSessionFreshness(session, context);
  if (freshness.fresh) return session;
  return advanceSession(session, "stale", now);
}

/** Whether a session may be offered for Apply at all. */
export function isApplicable(session: SemanticReviewSession): boolean {
  return session.state === "proposed";
}
