/**
 * The section index: claims by the section their evidence
 * lands in.
 *
 * Keyed by the section path — the heading hierarchy the
 * claim's evidence anchor carries — so a section's promise
 * and the claims indexed under it are one subject. C9
 * retrieves on this index.
 */

import type { NormalisedClaim } from "../normalisation";
import type { EvidenceAnchor } from "../contracts";

export interface SectionIndex {
  readonly sections: readonly string[];
  claimsFor(section: string): readonly string[];
}

/** The section key of an anchor: its heading path. */
export function sectionKey(anchor: EvidenceAnchor): string {
  return anchor.sectionPath.join(" > ");
}

export function buildSectionIndex(claims: readonly NormalisedClaim[]): SectionIndex {
  const bySection = new Map<string, string[]>();
  const add = (section: string, claimId: string): void => {
    const bucket = bySection.get(section);
    if (bucket === undefined) {
      bySection.set(section, [claimId]);
    } else if (!bucket.includes(claimId)) {
      bucket.push(claimId);
    }
  };
  claims.forEach(({ claim }) => {
    add(sectionKey(claim.evidence), claim.id);
  });
  return {
    sections: [...bySection.keys()],
    claimsFor(section: string): readonly string[] {
      return bySection.get(section) ?? [];
    },
  };
}
