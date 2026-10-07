/**
 * The programme index: claims by the programmes they are
 * measured against.
 *
 * A delay measured against the accepted baseline and a
 * disruption claim against the same programme meet here.
 * The programme type is what keeps a baseline apart from a
 * recovery programme; the index keys on the identifier the
 * extraction validated.
 */

import type { NormalisedClaim } from "../normalisation";

export interface ProgrammeIndex {
  readonly programmeIds: readonly string[];
  claimsFor(programmeId: string): readonly string[];
}

export function buildProgrammeIndex(claims: readonly NormalisedClaim[]): ProgrammeIndex {
  const byProgramme = new Map<string, string[]>();
  const add = (programmeId: string, claimId: string): void => {
    const bucket = byProgramme.get(programmeId);
    if (bucket === undefined) {
      byProgramme.set(programmeId, [claimId]);
    } else if (!bucket.includes(claimId)) {
      bucket.push(claimId);
    }
  };
  claims.forEach(({ claim }) => {
    claim.programmeIds.forEach((programmeId) => add(programmeId, claim.id));
  });
  return {
    programmeIds: [...byProgramme.keys()],
    claimsFor(programmeId: string): readonly string[] {
      return byProgramme.get(programmeId) ?? [];
    },
  };
}
