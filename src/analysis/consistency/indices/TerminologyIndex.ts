/**
 * The terminology index: claims by the terms they use.
 *
 * Every content word of a claim's predicate, folded to its
 * singular form, is a term the claim uses. A definition
 * claim and the claims that use its term meet here — which
 * is what C1 and C5 retrieve on.
 */

import { contentWords, singular } from "../checks/primitives";
import type { NormalisedClaim } from "../normalisation";

export interface TerminologyIndex {
  readonly terms: readonly string[];
  claimsFor(term: string): readonly string[];
}

/**
 * The terms a claim's predicate uses, singular-folded and
 * deduplicated, in first-use order.
 */
export function predicateTerms(predicateText: string): string[] {
  return [...new Set(contentWords(predicateText).map(singular))];
}

export function buildTerminologyIndex(claims: readonly NormalisedClaim[]): TerminologyIndex {
  const byTerm = new Map<string, string[]>();
  const add = (term: string, claimId: string): void => {
    const bucket = byTerm.get(term);
    if (bucket === undefined) {
      byTerm.set(term, [claimId]);
    } else if (!bucket.includes(claimId)) {
      bucket.push(claimId);
    }
  };
  claims.forEach(({ claim }) => {
    predicateTerms(claim.predicate.text).forEach((term) => add(term, claim.id));
  });
  return {
    terms: [...byTerm.keys()],
    claimsFor(term: string): readonly string[] {
      return byTerm.get(term) ?? [];
    },
  };
}
