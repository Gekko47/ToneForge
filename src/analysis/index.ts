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
export { detectSemanticDeviations, type DeviationOptions } from "./deviationEngine";
export {
  checkConsistency,
  type CheckConsistencyOptions,
  type ConsistencyReport,
  type ConsistencySummary,
  ConsistencyReportSchema,
  ConsistencySummarySchema,
} from "./consistencyChecker";
export { buildCoverage, type CoverageOptions } from "./coverage";
