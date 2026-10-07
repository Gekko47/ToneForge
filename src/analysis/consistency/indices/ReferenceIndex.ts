/**
 * The reference index: claims by the references they cite.
 *
 * A citation is a document reference or a contractual-basis
 * reference. C8 retrieves on this index: a claim and the
 * content its citation points at are one subject, not a
 * pair of claims.
 */

import { normalizeForComparison } from "../checks/primitives";
import type { NormalisedClaim } from "../normalisation";
import type { ExpertReportClaim } from "../contracts";

export interface ReferenceIndex {
  readonly citations: readonly string[];
  claimsFor(citation: string): readonly string[];
}

/**
 * Every citation a claim carries, folded for comparison.
 *
 * Document references and contractual-basis references are
 * citations as the document wrote them; a claim with no
 * citation is not indexed here.
 */
export function claimCitations(claim: ExpertReportClaim): string[] {
  const citations = [
    ...claim.documentRefIds,
    ...(claim.contractualBasis ?? []).map((basis) => basis.reference),
  ];
  return citations.map(normalizeForComparison).filter((citation) => citation.length > 0);
}

export function buildReferenceIndex(claims: readonly NormalisedClaim[]): ReferenceIndex {
  const byCitation = new Map<string, string[]>();
  const add = (citation: string, claimId: string): void => {
    const bucket = byCitation.get(citation);
    if (bucket === undefined) {
      byCitation.set(citation, [claimId]);
    } else if (!bucket.includes(claimId)) {
      bucket.push(claimId);
    }
  };
  claims.forEach(({ claim }) => {
    claimCitations(claim).forEach((citation) => add(citation, claim.id));
  });
  return {
    citations: [...byCitation.keys()],
    claimsFor(citation: string): readonly string[] {
      return byCitation.get(citation) ?? [];
    },
  };
}
