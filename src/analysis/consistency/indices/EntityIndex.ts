/**
 * The entity index: claims by the entities they assert about.
 *
 * Subject, object, and work-item references all name entities:
 * a delay claim about one activity and a disruption claim about
 * the same activity meet here, whatever facet each carries.
 */

import type { NormalisedClaim } from "../normalisation";

export interface EntityIndex {
  readonly entityIds: readonly string[];
  claimsFor(entityId: string): readonly string[];
}

export function buildEntityIndex(claims: readonly NormalisedClaim[]): EntityIndex {
  const byEntity = new Map<string, string[]>();
  const add = (entityId: string, claimId: string): void => {
    const bucket = byEntity.get(entityId);
    if (bucket === undefined) {
      byEntity.set(entityId, [claimId]);
    } else if (!bucket.includes(claimId)) {
      bucket.push(claimId);
    }
  };
  claims.forEach(({ claim }) => {
    claim.subjectIds.forEach((entityId) => add(entityId, claim.id));
    claim.objectIds.forEach((entityId) => add(entityId, claim.id));
    claim.workItemIds.forEach((entityId) => add(entityId, claim.id));
  });
  return {
    entityIds: [...byEntity.keys()],
    claimsFor(entityId: string): readonly string[] {
      return byEntity.get(entityId) ?? [];
    },
  };
}
