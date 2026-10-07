/**
 * The event index: claims by the events they assert about.
 *
 * A delay claim and a disruption claim about one event meet
 * here, so C1 and C3 can retrieve them without scanning every
 * claim pair.
 */

import type { NormalisedClaim } from "../normalisation";

export interface EventIndex {
  readonly eventIds: readonly string[];
  claimsFor(eventId: string): readonly string[];
}

export function buildEventIndex(claims: readonly NormalisedClaim[]): EventIndex {
  const byEvent = new Map<string, string[]>();
  const add = (eventId: string, claimId: string): void => {
    const bucket = byEvent.get(eventId);
    if (bucket === undefined) {
      byEvent.set(eventId, [claimId]);
    } else if (!bucket.includes(claimId)) {
      bucket.push(claimId);
    }
  };
  claims.forEach(({ claim }) => {
    claim.eventIds.forEach((eventId) => add(eventId, claim.id));
  });
  return {
    eventIds: [...byEvent.keys()],
    claimsFor(eventId: string): readonly string[] {
      return byEvent.get(eventId) ?? [];
    },
  };
}
