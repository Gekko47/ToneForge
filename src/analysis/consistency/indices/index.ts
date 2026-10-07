/**
 * The nine indices (original §8).
 *
 * Import from here rather than from the individual
 * index modules: the index layout is a detail of the
 * engine, and the retrievers depend on the aggregate.
 */

export { buildClaimIndex, type ClaimIndex } from "./ClaimIndex";
export { buildEntityIndex, type EntityIndex } from "./EntityIndex";
export { buildEventIndex, type EventIndex } from "./EventIndex";
export { buildProgrammeIndex, type ProgrammeIndex } from "./ProgrammeIndex";
export { buildQuantityIndex, type QuantityIndex } from "./QuantityIndex";
export { buildReferenceIndex, type ReferenceIndex } from "./ReferenceIndex";
export { buildSectionIndex, sectionKey, type SectionIndex } from "./SectionIndex";
export { buildTerminologyIndex, predicateTerms, type TerminologyIndex } from "./TerminologyIndex";
export { buildTemporalIndex, type TemporalIndex } from "./TemporalIndex";
export { buildIndices, type ConsistencyIndices } from "./buildIndices";
