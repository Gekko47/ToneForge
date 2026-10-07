/**
 * The ten retrievers (original §9).
 *
 * Import from the registry: `retrieveCandidates`
 * runs every check's retrieval over the indices
 * and applies the per-subject caps. The
 * individual retrievers are the rules, one per
 * check, and are exported for testing.
 */

export { retrieveC1 } from "./c1Terminology";
export { retrieveC2 } from "./c2Numeric";
export { retrieveC3 } from "./c3Temporal";
export { retrieveC4 } from "./c4EntityAttribute";
export { retrieveC5 } from "./c5Definition";
export { retrieveC6 } from "./c6Unit";
export { retrieveC7 } from "./c7Status";
export { retrieveC8 } from "./c8Reference";
export { retrieveC9 } from "./c9SectionPromise";
export { retrieveC10 } from "./c10Scope";
export {
  capSubjectClaims,
  evidenceIdsFor,
  makeCandidate,
  retrieveCandidates,
  subjectKey,
  type CheckRetrieval,
  type CheckRetriever,
  type RetrievalContext,
} from "./registry";
