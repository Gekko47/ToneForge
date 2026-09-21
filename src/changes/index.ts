/** Public Stage 17 change-planning contracts. */

export { planChanges, createChangePlanFromFindings, type PlanOptions } from "./planner";
export { detectConflicts } from "./conflictDetector";
export { isStale, markStale } from "./staleGuard";
