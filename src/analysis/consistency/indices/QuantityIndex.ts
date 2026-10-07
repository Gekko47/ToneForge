/**
 * The quantity index: claims by the values they assert.
 *
 * The key is magnitude, unit, and currency, so
 * `1,250,000 USD` and `1250000 USD` are one entry, and a
 * figure in another currency is another. A value with no
 * parsed magnitude is not indexed — unknown stays unknown.
 */

import { quantityKey } from "../normalisation/quantities";
import type { NormalisedClaim } from "../normalisation";

export interface QuantityIndex {
  readonly quantityKeys: readonly string[];
  claimsFor(key: string): readonly string[];
}

export function buildQuantityIndex(claims: readonly NormalisedClaim[]): QuantityIndex {
  const byQuantity = new Map<string, string[]>();
  const add = (key: string, claimId: string): void => {
    const bucket = byQuantity.get(key);
    if (bucket === undefined) {
      byQuantity.set(key, [claimId]);
    } else if (!bucket.includes(claimId)) {
      bucket.push(claimId);
    }
  };
  claims.forEach(({ claim, values }) => {
    values.forEach((value) => {
      const key = quantityKey(value);
      if (key !== null) add(key, claim.id);
    });
  });
  return {
    quantityKeys: [...byQuantity.keys()],
    claimsFor(key: string): readonly string[] {
      return byQuantity.get(key) ?? [];
    },
  };
}
