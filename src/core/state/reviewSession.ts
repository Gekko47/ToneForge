/**
 * Review-session persistence (spec §16).
 *
 * The session is the thing that makes "Approve" mean anything: a decision is
 * bound to a document revision, a profile revision, a governance revision and a
 * coverage fingerprint, and all of it is discarded the moment any one of them
 * moves. The module is a thin writer over `persistence.ts` rather than part of
 * it, so the store's schema stays a statement about *shape* and this file stays
 * a statement about *when decisions expire*.
 *
 * The user's answer to the open question was explicit: invalidate wholesale,
 * carry nothing across, and do not back-migrate. There is no partial survival
 * and no attempt to prove an old approval still applies — a mixture of two
 * reviews with nothing on screen distinguishing them is the failure this design
 * exists to prevent.
 */

import { logger } from "../../shared/utils/logger";
import {
  changedIdentityFields,
  DeterministicReviewSessionSchema,
  ReviewDecisionSchema,
  ReviewSessionIdentitySchema,
  type DeterministicReviewSession,
  type ReviewDecision,
  type ReviewSessionIdentity,
} from "../domain/ReviewSession";
import { loadState, saveState } from "./persistence";

/**
 * The stored session, or null when there is none.
 *
 * Validated on read rather than trusted: the store is user-writable through two
 * different backends, and a session that fails its schema must be treated as
 * absent rather than as an approval. A malformed session that survives would
 * either block every review or, worse, be repaired into one that carries
 * decisions nobody made.
 */
export function loadReviewSession(): DeterministicReviewSession | null {
  const stored = loadState().deterministicReviewSession;
  if (stored === null || stored === undefined) return null;
  const parsed = DeterministicReviewSessionSchema.safeParse(stored);
  if (!parsed.success) {
    logger.warn("Discarding an unreadable deterministic review session", {
      errorType: parsed.error.name,
    });
    clearReviewSession();
    return null;
  }
  return parsed.data;
}

/**
 * The session for `identity`, starting a fresh one if the stored one does not
 * apply.
 *
 * This is the call a review run makes when it has a report, and it is where
 * invalidation happens. Returns the session in force along with the identity
 * fields that moved, so the pane can say *why* the user's approvals are gone
 * rather than silently presenting an empty list.
 */
export function ensureReviewSession(identity: ReviewSessionIdentity): {
  session: DeterministicReviewSession;
  invalidatedBy: string[];
} {
  const wanted = ReviewSessionIdentitySchema.parse(identity);
  const stored = loadReviewSession();
  /*
   * Computed once, outside the branch.
   *
   * It was previously derived twice: once to decide whether to keep the stored
   * session, and again in the return to populate `invalidatedBy`. Two calls to
   * the same pure function cannot disagree today, but the second one is a
   * second statement of the same fact, and the pane shows the result as *why*
   * the user's approvals are gone — so a future edit to one and not the other
   * would report a reason the branch never acted on.
   */
  const changed = stored === null ? [] : changedIdentityFields(stored.identity, wanted);
  if (stored !== null) {
    if (changed.length === 0) return { session: stored, invalidatedBy: [] };
    logger.info("Deterministic review session invalidated", { changed });
  }
  const fresh = DeterministicReviewSessionSchema.parse({
    identity: wanted,
    decisions: [],
    updatedAt: new Date().toISOString(),
  });
  writeSession(fresh);
  return { session: fresh, invalidatedBy: changed };
}

/**
 * Record a decision, replacing any prior one for the same occurrence.
 *
 * The newest wins rather than both surviving: a user who approves a finding and
 * then skips it has made one decision, and a list showing both would be a list
 * whose contents depend on how many times they changed their mind.
 */
export function saveReviewDecision(decision: ReviewDecision): void {
  const parsed = ReviewDecisionSchema.parse(decision);
  const state = loadState();
  const current = state.deterministicReviewSession;
  if (!current) {
    throw new Error(
      "saveReviewDecision: no review session is in force; call ensureReviewSession first so the decision is bound to an identity",
    );
  }
  const retained = current.decisions.filter((item) => item.identity !== parsed.identity);
  state.deterministicReviewSession = DeterministicReviewSessionSchema.parse({
    ...current,
    decisions: [...retained, parsed],
    updatedAt: new Date().toISOString(),
  });
  saveState(state);
}

/**
 * Withdraw a decision, so the occurrence can be reviewed again.
 *
 * This is what the "Undo decision" control calls, and it is also what expiry
 * calls: an occurrence that no longer exists in the current document has not
 * been decided, and the honest state for it is undecided.
 */
export function clearReviewDecision(identity: string): void {
  const state = loadState();
  const current = state.deterministicReviewSession;
  if (!current) return;
  const retained = current.decisions.filter((item) => item.identity !== identity);
  if (retained.length === current.decisions.length) return;
  state.deterministicReviewSession = DeterministicReviewSessionSchema.parse({
    ...current,
    decisions: retained,
    updatedAt: new Date().toISOString(),
  });
  saveState(state);
}

/** Discard the whole session. Used when the document is closed or the profile is removed. */
export function clearReviewSession(): void {
  const state = loadState();
  if (state.deterministicReviewSession === null) return;
  state.deterministicReviewSession = null;
  saveState(state);
}

function writeSession(session: DeterministicReviewSession): void {
  const state = loadState();
  state.deterministicReviewSession = session;
  saveState(state);
}
