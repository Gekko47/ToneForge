/**
 * The nine indices, built once per run (original §8).
 *
 * Building is deterministic: the same claims always
 * produce the same indices, so the same retrieval runs
 * over the same subjects whatever order the claims
 * arrived in.
 */

import type { NormalisedClaim } from "../normalisation";
import { buildClaimIndex, type ClaimIndex } from "./ClaimIndex";
import { buildEntityIndex, type EntityIndex } from "./EntityIndex";
import { buildEventIndex, type EventIndex } from "./EventIndex";
import { buildProgrammeIndex, type ProgrammeIndex } from "./ProgrammeIndex";
import { buildQuantityIndex, type QuantityIndex } from "./QuantityIndex";
import { buildReferenceIndex, type ReferenceIndex } from "./ReferenceIndex";
import { buildSectionIndex, type SectionIndex } from "./SectionIndex";
import { buildTerminologyIndex, type TerminologyIndex } from "./TerminologyIndex";
import { buildTemporalIndex, type TemporalIndex } from "./TemporalIndex";

/** The nine indices every check retrieves from. */
export interface ConsistencyIndices {
  readonly claims: ClaimIndex;
  readonly entities: EntityIndex;
  readonly events: EventIndex;
  readonly temporal: TemporalIndex;
  readonly quantities: QuantityIndex;
  readonly terminology: TerminologyIndex;
  readonly references: ReferenceIndex;
  readonly programmes: ProgrammeIndex;
  readonly sections: SectionIndex;
}

export function buildIndices(claims: readonly NormalisedClaim[]): ConsistencyIndices {
  return {
    claims: buildClaimIndex(claims),
    entities: buildEntityIndex(claims),
    events: buildEventIndex(claims),
    temporal: buildTemporalIndex(claims),
    quantities: buildQuantityIndex(claims),
    terminology: buildTerminologyIndex(claims),
    references: buildReferenceIndex(claims),
    programmes: buildProgrammeIndex(claims),
    sections: buildSectionIndex(claims),
  };
}
