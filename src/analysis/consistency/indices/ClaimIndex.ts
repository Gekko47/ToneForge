/**
 * The claim index: every claim the engine holds, by its canonical
 * id.
 *
 * The master index — every other index maps a key to claim ids,
 * and the claim index turns those ids back into claims.
 */

import type { NormalisedClaim } from "../normalisation";

export interface ClaimIndex {
  readonly claimIds: readonly string[];
  byId(claimId: string): NormalisedClaim | null;
}

export function buildClaimIndex(claims: readonly NormalisedClaim[]): ClaimIndex {
  const byId = new Map<string, NormalisedClaim>();
  claims.forEach((normalised) => {
    byId.set(normalised.claim.id, normalised);
  });
  return {
    claimIds: [...byId.keys()],
    byId(claimId: string): NormalisedClaim | null {
      return byId.get(claimId) ?? null;
    },
  };
}
