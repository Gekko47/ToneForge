export {
  acquireAnalysisContext,
  type AnalysisAcquisitionOptions,
} from "../word/analysisAcquisition";
export {
  createAnalysisContext,
  type AnalysisCapabilities,
  type AnalysisContext,
  type AcquisitionDiagnostics,
} from "./analysisContext";
export { unifyFindings, type UnifyOptions } from "./unifiedFindings";
export * from "./semantic";
export {
  runDeterministicReview,
  groupFindings,
  summarize,
  type DeterministicReviewReport,
} from "./deterministic/deterministicReviewEngine";
export type {
  DeterministicFinding,
  DeterministicFindingGroup,
  DeterministicReviewOptions,
  DeterministicReviewSummary,
  DeterministicCoverage,
  ScopeKind,
} from "./deterministic/contracts";
export { buildCoverage, type CoverageOptions } from "./coverage";
