/**
 * The temporal index: claims by the dates they carry.
 *
 * A claim is indexed under every date it asserts, with the
 * date's precision in the key, so two claims about one day
 * meet whatever form the document used — and a month never
 * silently equals a day.
 */

import { dateKey } from "../normalisation/dates";
import type { NormalisedClaim } from "../normalisation";

export interface TemporalIndex {
  readonly dateKeys: readonly string[];
  claimsFor(key: string): readonly string[];
}

export function buildTemporalIndex(claims: readonly NormalisedClaim[]): TemporalIndex {
  const byDate = new Map<string, string[]>();
  const add = (key: string, claimId: string): void => {
    const bucket = byDate.get(key);
    if (bucket === undefined) {
      byDate.set(key, [claimId]);
    } else if (!bucket.includes(claimId)) {
      bucket.push(claimId);
    }
  };
  claims.forEach(({ claim, dates }) => {
    dates.forEach(({ date }) => {
      const key = dateKey(date);
      if (key !== null) add(key, claim.id);
    });
  });
  return {
    dateKeys: [...byDate.keys()],
    claimsFor(key: string): readonly string[] {
      return byDate.get(key) ?? [];
    },
  };
}
