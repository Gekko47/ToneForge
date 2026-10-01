/**
 * Semantic review session and its minimised outcome log.
 *
 * **Two objects, one file, and the difference is the whole point.**
 *
 * A `SemanticReviewSession` is *in-memory and never persisted*. It holds the
 * text the user pointed at and the proposal the model returned, and it exists so
 * that a proposal can be invalidated the moment it stops describing what is on
 * screen. The specification's §20 places the session in state; it does not have
 * to be, and persisting it would mean writing document text to
 * `Office.roamingSettings` on every review — which is precisely the thing the
 * privacy rule exists to prevent, reached by a route nobody named.
 *
 * A `SemanticReviewOutcome` is the opposite: persisted, and carrying nothing but
 * the answer to "did my last semantic review get written, and under which
 * profile". No text, no document identity, no content hash. An earlier draft
 * carried `documentId` and `documentHash` and the observability notes described
 * the log as something "a user can see" — with no history surface specified
 * anywhere in the specification or the plan. Two unsupported claims, and the
 * identifiers were the expensive half: a document id plus a content hash is a
 * durable fingerprint of which document a user ran a model against, retained
 * across twenty entries, for a surface that does not exist.
 *
 * Boundary rule: `core/domain` imports zod and `shared/utils` only.
 */

import { z } from "zod";

/**
 * How many outcomes are retained.
 *
 * Twenty, matching `ProfileRecord`'s `REVISION_RETENTION_CAP`. Not because the
 * two are related — they are not — but because both are the smallest number that
 * lets a person answer "what has happened recently" without the store growing
 * without bound, and one number is easier to reason about than two.
 */
export const SEMANTIC_REVIEW_OUTCOME_CAP = 20;

/**
 * Where a learned-style sample came from.
 *
 * **Four named sources, and the split is load-bearing.** The evidence is shown
 * to the user as the basis for a profile, so "learned from your selection" and
 * "learned from a file you picked" are different claims and a profile that
 * reports the wrong one is a claim the evidence cannot support. `pasted_text` and
 * `text_file` are both things the user supplied but by different means — one is
 * gone when the pane closes and the other has a name — and `word_selection` and
 * `word_document` are both Word but only one is a deliberate act of pointing.
 *
 * Declared here rather than in `style/sampleCapture.ts` because it is persisted:
 * `SemanticSampleEvidence` stores it, so a store written by one build must be
 * readable by the next, and a list that lives in the module that produces the
 * value is a list the migration has to import from a layer it should not depend
 * on. `sampleCapture.ts` re-exports it, so `style/` callers still have one
 * import site.
 */
export const SEMANTIC_SAMPLE_SOURCES = [
  "pasted_text",
  "text_file",
  "word_selection",
  "word_document",
] as const;
export const SemanticSampleSourceSchema = z.enum(SEMANTIC_SAMPLE_SOURCES);
export type SemanticSampleSource = z.infer<typeof SemanticSampleSourceSchema>;

/**
 * The evidence behind a learned profile: what was learned from, and how much of
 * it there was. Never the text.
 *
 * **There is no `text` field, and that is enforced rather than asserted.** A
 * reflection test walks the schema's shape and fails if any field's name or type
 * can hold document content — the same technique the `ProviderConnection`
 * credential test uses, for the same reason: a leak prevented at the schema is
 * a leak that cannot ship, and a leak noticed in review is a leak that already
 * did.
 *
 * What the evidence is *for*. The Semantic Style tab has to be able to say "this
 * profile was learned from 412 words you pasted on 3 March" — which is a claim a
 * user can check against their own memory and hold the add-in to. It is not for
 * re-reading the sample, which would make the text a stored document copy and
 * turn the profile's provenance into a second copy of the user's writing.
 */
export const SemanticSampleEvidenceSchema = z.object({
  id: z.string().uuid(),
  source: SemanticSampleSourceSchema,
  /** Present only for a `.txt` import; the file's name, never its path. */
  filename: z.string().trim().min(1).max(255).optional(),
  documentId: z.string().trim().min(1).optional(),
  wordCount: z.number().int().nonnegative(),
  sentenceCount: z.number().int().nonnegative(),
  paragraphCount: z.number().int().nonnegative(),
  capturedAt: z.string().datetime(),
  /** `hashText(sample.text)` — proves two captures matched without keeping either. */
  sampleHash: z.string().trim().min(1),
});
export type SemanticSampleEvidence = z.infer<typeof SemanticSampleEvidenceSchema>;

/**
 * Where the user pointed, and what was there when they did.
 *
 * **No whole-document hash, deliberately.** An earlier draft carried
 * `documentHash`, and that would have defeated this phase's own performance
 * claim: producing a whole-document hash requires reading the whole document,
 * which is exactly the read the selection-scope reader exists to avoid. The
 * document's identity is `documentId` — the host's own id, or the content-hash
 * fallback `documentReader` already computes when a host omits it. The target's
 * identity is `selectionHash` over the selected text.
 *
 * Staleness is not this anchor's job either. It is enforced where it already
 * works and costs nothing extra: the revision adapter's exact `text` precondition
 * compared against the live document, plus the `structuralHash` the reformat
 * acquisition path already holds. Neither requires a new read on the propose
 * path.
 */
export const SemanticSelectionAnchorSchema = z.object({
  /** Host document identity. Cheap; never a fresh read on the propose path. */
  documentId: z.string().trim().min(1),
  /**
   * Containing paragraphs, when the host exposes their ids.
   *
   * Optional, and honestly so: `uniqueLocalId` is not universal across Word
   * hosts. A required field here would force a fabricated id rather than an
   * absent one, and a fabricated node id is worse than none — it would satisfy
   * the type and fail at write time. An empty array degrades to
   * offset-plus-precondition targeting, and Troubleshooting reports it as an
   * unverified anchor rather than a verified one.
   */
  nodeIds: z.array(z.string().trim().min(1)).default([]),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  /** The text as captured. In-memory only; never reaches the persisted log. */
  selectedText: z.string().min(1),
  /** `hashText(selectedText)` — the cheap, sufficient identity of the target. */
  selectionHash: z.string().trim().min(1),
  capturedAt: z.string().datetime(),
});
export type SemanticSelectionAnchor = z.infer<typeof SemanticSelectionAnchorSchema>;

/**
 * Where a semantic review has got to.
 *
 * `stale` is a state rather than an absence because the pane has to say *why*
 * nothing can be applied. A session that simply vanished leaves the user looking
 * at a proposal that no longer means anything; `stale` names the condition.
 *
 * `failed` is separate from `stale` for the same reason: a provider error is
 * retryable and a changed selection is not, and ADR-0069 requires every refusal
 * to name the control that resolves it.
 */
export const SemanticReviewStateSchema = z.enum([
  "ready",
  "reviewing",
  "proposed",
  "applied",
  "kept_original",
  "stale",
  "failed",
]);
export type SemanticReviewState = z.infer<typeof SemanticReviewStateSchema>;

/**
 * One in-flight semantic review.
 *
 * **Built without `assessment` and `preservation` in P1, and extended in P4.**
 * Those two fields are typed by the review engine's contracts and the local
 * preservation validator, neither of which exists yet. Zod objects are
 * extendable, so adding them is one `.extend()` call in P4 rather than an edit
 * to a schema that four other modules would have to be re-read against in the
 * meantime. What is here is the part that has to exist first: the identity a
 * proposal is invalidated against.
 *
 * The identity is deliberately narrower than the deterministic review session's
 * (`src/core/domain/ReviewSession.ts`). That session binds to a document
 * version, a structural hash and a coverage fingerprint because it approves
 * *individual findings against an examined scope*. A semantic review has no
 * scope to examine — it is one selection — so the only two things that can
 * invalidate it are the text it was about and the profile it reasoned from, and
 * both are already here.
 */
export const SemanticReviewSessionSchema = z.object({
  id: z.string().uuid(),
  /** The profile the review reasoned from. A different revision invalidates it. */
  profileId: z.string().uuid(),
  profileRevision: z.number().int().positive(),
  selection: SemanticSelectionAnchorSchema,
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  startedAt: z.string().datetime(),
  /** Absent while the review is still running or has never completed. */
  completedAt: z.string().datetime().optional(),
  state: SemanticReviewStateSchema,
});
export type SemanticReviewSession = z.infer<typeof SemanticReviewSessionSchema>;

/**
 * What became of a completed semantic review.
 *
 * **The only part of a semantic review that is persisted**, and reflection-tested
 * so a future field cannot quietly reintroduce document text or a document
 * fingerprint. That mirrors the `ProviderConnection` credential test, and for
 * the same reason: the schema is the only place a leak can be prevented rather
 * than noticed.
 *
 * One entry per session, collapsed — a session that was applied, then
 * regenerated, then applied again is one review with two outcomes, and storing
 * three rows would imply three reviews happened.
 */
export const SemanticReviewOutcomeSchema = z.object({
  sessionId: z.string().uuid(),
  profileId: z.string().uuid(),
  profileRevision: z.number().int().positive(),
  outcome: z.enum(["applied", "kept_original", "regenerated", "refused"]),
  at: z.string().datetime(),
  /**
   * Whether the local preservation check passed when the outcome was recorded.
   *
   * Recorded rather than inferred so a later question — "did anything get
   * written that dropped a number?" — is answerable from the store. It is a
   * boolean about the check, not a copy of what the check found.
   */
  preservationPassed: z.boolean(),
  /** A count, never the text. Enough to tell a paragraph from a chapter. */
  selectionWordCount: z.number().int().nonnegative(),
});
export type SemanticReviewOutcome = z.infer<typeof SemanticReviewOutcomeSchema>;

/**
 * The retained outcomes: newest last, at most `SEMANTIC_REVIEW_OUTCOME_CAP`,
 * one row per session.
 *
 * A row is replaced rather than appended to when its session already has one, so
 * the cap counts reviews rather than actions — otherwise a user who regenerates
 * twenty times has an audit trail consisting entirely of one review and no
 * history at all.
 */
export function appendSemanticOutcome(
  existing: readonly SemanticReviewOutcome[],
  outcome: SemanticReviewOutcome,
): SemanticReviewOutcome[] {
  const withoutSession = existing.filter((entry) => entry.sessionId !== outcome.sessionId);
  const next = [...withoutSession, outcome];
  return next.length > SEMANTIC_REVIEW_OUTCOME_CAP
    ? next.slice(next.length - SEMANTIC_REVIEW_OUTCOME_CAP)
    : next;
}
