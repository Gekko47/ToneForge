/**
 * Pass B: global canonical resolution (original §7).
 *
 * Pass A extracts each section locally; Pass B
 * resolves identity across the whole document.
 * Claims are ordered by their evidence position in
 * the document, and duplicates — the same speaker
 * asserting the same predicate against the same
 * evidence span, extracted twice — collapse into
 * one. The survivors are handed to the evidence
 * validator, which assigns canonical ids after
 * validation.
 *
 * ToneForge owns the ids: the model never assigns
 * one, and a claim whose evidence does not resolve
 * keeps only its provisional id in the quarantine
 * record, for traceability.
 */

import type { ExpertReportClaim } from "../contracts";
import {
  canonicalAnchorId,
  validateEvidence,
  type EvidenceValidationResult,
} from "./evidenceValidator";

/** What Pass B needs: the document and Pass A's claims. */
export interface CanonicalResolutionInput {
  documentId: string;
  text: string;
  claims: ExpertReportClaim[];
}

/**
 * Resolve Pass A's claims to canonical claims.
 *
 * Document order is evidence order: the anchor's
 * start offset is the claim's position in the
 * document, so sorting by it orders claims the way
 * a reader meets them, whatever order the batches
 * produced. Two claims are the same claim when the
 * same speaker asserts the same predicate against
 * the same evidence span; the first in document
 * order wins.
 */
export function resolveCanonicalClaims(input: CanonicalResolutionInput): EvidenceValidationResult {
  const ordered = [...input.claims].sort((a, b) => a.evidence.startOffset - b.evidence.startOffset);
  const seen = new Set<string>();
  const distinct: ExpertReportClaim[] = [];
  ordered.forEach((claim) => {
    const identity = `${claim.speaker.id}|${claim.predicate.text}|${canonicalAnchorId(claim.evidence)}`;
    if (seen.has(identity)) {
      return;
    }
    seen.add(identity);
    distinct.push(claim);
  });

  return validateEvidence({
    documentId: input.documentId,
    text: input.text,
    claims: distinct,
  });
}
