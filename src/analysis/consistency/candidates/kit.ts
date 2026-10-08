/**
 * The shared retrieval kit (original §9 and §10).
 *
 * The helpers every retriever uses — the retrieval
 * context, the per-subject cap, the candidate builder —
 * live here, apart from the registry that dispatches
 * the retrievers. A retriever depends on this kit, and
 * the registry depends on the retrievers, so the two
 * never import each other: the dispatch table is built
 * after every retriever is defined, not while one is
 * still being evaluated.
 */

import { hashText } from "../../../shared/utils/text";
import { canonicalAnchorId } from "../extraction/evidenceValidator";
import type { ConsistencyCandidate, ConsistencyCheckId, DecisionSubject } from "../contracts";
import type { AliasIndex } from "../normalisation/aliases";
import type { ConsistencyIndices } from "../indices";

/**
 * What the retrievers need: the indices (which hold
 * the normalised claims), the alias index, and the
 * per-subject cap.
 */
export interface RetrievalContext {
  readonly indices: ConsistencyIndices;
  readonly aliases: AliasIndex;
  readonly maxPerSubject: number;
  /**
   * The checks to run. Absent or empty means all ten, so a caller that does not
   * select still runs the full set rather than silently running nothing.
   */
  readonly checks?: readonly ConsistencyCheckId[];
}

/** What one check's retrieval produces. */
export interface CheckRetrieval {
  readonly candidates: readonly ConsistencyCandidate[];
  readonly blockOverflowSkipped: number;
}

/** A retriever: one check's rule, applied to the indices. */
export type CheckRetriever = (ctx: RetrievalContext) => CheckRetrieval;

/**
 * The canonical key of a decision subject: its kind
 * and identity. Two candidates about one subject share
 * a key, whatever check retrieved them.
 */
export function subjectKey(subject: DecisionSubject): string {
  switch (subject.kind) {
    case "entity":
      return `entity:${subject.name}`;
    case "event":
      return `event:${subject.description}`;
    case "programme":
      return `programme:${subject.identifier}`;
    case "quantum":
      return `quantum:${subject.measure}:${subject.unit}`;
    case "reference":
      return `reference:${subject.citation}`;
    case "section":
      return `section:${subject.heading}`;
    case "term":
      return `term:${subject.term}`;
    case "unknown":
      return `unknown:${subject.reason}`;
  }
}

/**
 * Apply the per-subject cap to one subject's claims.
 *
 * The first `maxPerSubject` claims in document order
 * enter the candidate; the rest are counted as skipped,
 * so a capped run says how much it did not read rather
 * than silently reviewing a prefix.
 */
export function capSubjectClaims(
  claimIds: readonly string[],
  maxPerSubject: number,
): { kept: readonly string[]; skipped: number } {
  if (claimIds.length <= maxPerSubject) {
    return { kept: claimIds, skipped: 0 };
  }
  return {
    kept: claimIds.slice(0, maxPerSubject),
    skipped: claimIds.length - maxPerSubject,
  };
}

/**
 * The evidence ids of a set of claims: the canonical
 * ids of the anchors their evidence resolves to.
 */
export function evidenceIdsFor(claimIds: readonly string[], ctx: RetrievalContext): string[] {
  const ids: string[] = [];
  claimIds.forEach((claimId) => {
    const normalised = ctx.indices.claims.byId(claimId);
    if (normalised === null) return;
    const id = canonicalAnchorId(normalised.claim.evidence);
    if (!ids.includes(id)) ids.push(id);
  });
  return ids;
}

/**
 * Build one candidate, with its id, fingerprint, and
 * pending state.
 *
 * The fingerprint is a content hash of the check, the
 * subject, and the claims: two runs over the same
 * document produce the same fingerprints, so a
 * candidate can be traced across runs.
 */
export function makeCandidate(
  checkId: ConsistencyCheckId,
  ordinal: number,
  subject: DecisionSubject,
  claimIds: readonly string[],
  retrieval: ConsistencyCandidate["retrieval"],
  evidenceIds: readonly string[],
): ConsistencyCandidate {
  const fingerprint = `${checkId}|${subjectKey(subject)}|${claimIds.join(",")}`;
  return {
    id: `${checkId}-${String(ordinal).padStart(4, "0")}`,
    checkId,
    subject,
    fingerprint: hashText(fingerprint),
    claimIds: [...claimIds],
    retrieval,
    evidenceIds: [...evidenceIds],
    state: "pending",
  };
}
