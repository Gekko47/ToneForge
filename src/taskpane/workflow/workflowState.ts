import type { CapabilityEvidenceTier } from "../../word/capabilityEvidence";
import type { CoverageReport, Finding } from "../../core/domain";

export type ScanStatus =
  "idle" | "scanning" | "fresh" | "clean" | "stale" | "incomplete" | "failed";
export type ApplyStatus = "idle" | "ready" | "applying" | "verified" | "refused" | "failed";
export type PlanReviewStatus = "empty" | "previewing" | "ready" | "rejected";

export interface WorkflowState {
  document: {
    documentId: string | null;
    version: string | null;
    selection: { text: string; start: number; end: number } | null;
    changedNodeIds: string[];
    capabilityTier: CapabilityEvidenceTier | "unsupported";
  };
  analysis: {
    profileId: string | null;
    policyRevision: number | null;
    scanStatus: ScanStatus;
    coverage: CoverageReport | null;
    findings: Finding[];
  };
  planReview: {
    planId: string | null;
    status: PlanReviewStatus;
    selectedFindingIndex: number | null;
    selectedChangeIndex: number | null;
    conflictCount: number;
  };
  apply: { status: ApplyStatus; message: string | null };
  troubleshooting: { lastError: string | null };
}

export type WorkflowAction =
  | {
      type: "document/context";
      documentId: string;
      version: string;
      capabilityTier: WorkflowState["document"]["capabilityTier"];
    }
  | { type: "document/selection"; selection: WorkflowState["document"]["selection"] }
  | { type: "document/changedNodes"; nodeIds: string[] }
  | { type: "analysis/policy"; profileId: string; policyRevision: number }
  | { type: "analysis/scan"; scanStatus: ScanStatus; coverage?: CoverageReport | null }
  | { type: "analysis/findings"; findings: Finding[] }
  | { type: "plan/previewing" }
  | { type: "plan/ready"; planId: string; conflictCount: number }
  | { type: "plan/selectFinding"; index: number | null }
  | { type: "plan/selectChange"; index: number | null }
  | { type: "plan/reject" }
  | { type: "apply/status"; status: ApplyStatus; message?: string | null }
  | { type: "troubleshooting/error"; message: string | null };

export function createWorkflowState(): WorkflowState {
  return {
    document: {
      documentId: null,
      version: null,
      selection: null,
      changedNodeIds: [],
      capabilityTier: "unsupported",
    },
    analysis: {
      profileId: null,
      policyRevision: null,
      scanStatus: "idle",
      coverage: null,
      findings: [],
    },
    planReview: {
      planId: null,
      status: "empty",
      selectedFindingIndex: null,
      selectedChangeIndex: null,
      conflictCount: 0,
    },
    apply: { status: "idle", message: null },
    troubleshooting: { lastError: null },
  };
}

function clampIndex(index: number | null, length: number): number | null {
  if (index === null || length === 0) return null;
  return Math.min(Math.max(index, 0), length - 1);
}

export function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  switch (action.type) {
    case "document/context":
      return {
        ...state,
        document: {
          ...state.document,
          documentId: action.documentId,
          version: action.version,
          capabilityTier: action.capabilityTier,
        },
      };
    case "document/selection":
      return { ...state, document: { ...state.document, selection: action.selection } };
    case "document/changedNodes":
      return {
        ...state,
        document: { ...state.document, changedNodeIds: [...new Set(action.nodeIds)] },
      };
    case "analysis/policy":
      return {
        ...state,
        analysis: {
          ...state.analysis,
          profileId: action.profileId,
          policyRevision: action.policyRevision,
        },
      };
    case "analysis/scan":
      return {
        ...state,
        analysis: {
          ...state.analysis,
          scanStatus: action.scanStatus,
          coverage: "coverage" in action ? (action.coverage ?? null) : state.analysis.coverage,
        },
      };
    case "analysis/findings":
      return {
        ...state,
        analysis: { ...state.analysis, findings: [...action.findings] },
        planReview: {
          ...state.planReview,
          selectedFindingIndex: clampIndex(
            state.planReview.selectedFindingIndex,
            action.findings.length,
          ),
        },
      };
    case "plan/previewing":
      return {
        ...state,
        planReview: { ...state.planReview, status: "previewing" },
        apply: { status: "idle", message: null },
      };
    case "plan/ready":
      return {
        ...state,
        planReview: {
          ...state.planReview,
          planId: action.planId,
          status: "ready",
          conflictCount: action.conflictCount,
        },
        apply: { status: "ready", message: null },
      };
    case "plan/selectFinding":
      return {
        ...state,
        planReview: {
          ...state.planReview,
          selectedFindingIndex: clampIndex(action.index, state.analysis.findings.length),
        },
      };
    case "plan/selectChange":
      return {
        ...state,
        planReview: {
          ...state.planReview,
          selectedChangeIndex: action.index === null ? null : Math.max(action.index, 0),
        },
      };
    case "plan/reject":
      return {
        ...state,
        planReview: {
          planId: null,
          status: "rejected",
          selectedFindingIndex: null,
          selectedChangeIndex: null,
          conflictCount: 0,
        },
        apply: { status: "idle", message: "Plan rejected. Nothing was applied." },
      };
    case "apply/status":
      return { ...state, apply: { status: action.status, message: action.message ?? null } };
    case "troubleshooting/error":
      return { ...state, troubleshooting: { lastError: action.message } };
  }
}

export function selectNextFindingIndex(state: WorkflowState): number | null {
  const total = state.analysis.findings.length;
  if (total === 0) return null;
  const current = state.planReview.selectedFindingIndex;
  return current === null ? 0 : (current + 1) % total;
}

export function selectPreviousFindingIndex(state: WorkflowState): number | null {
  const total = state.analysis.findings.length;
  if (total === 0) return null;
  const current = state.planReview.selectedFindingIndex;
  return current === null ? total - 1 : (current - 1 + total) % total;
}

export function selectCurrentTask(state: WorkflowState): { label: string; nextAction: string } {
  if (state.analysis.scanStatus === "idle") return { label: "Not started", nextAction: "Scan now" };
  if (state.analysis.scanStatus === "scanning")
    return { label: "Scanning", nextAction: "Wait for the current scan" };
  if (state.analysis.scanStatus === "failed")
    return { label: "Scan failed", nextAction: "Re-scan now" };
  if (state.analysis.scanStatus === "stale")
    return { label: "Findings are stale", nextAction: "Re-scan now" };
  if (state.planReview.status === "rejected")
    return { label: "Plan rejected", nextAction: "Preview again" };
  if (state.planReview.status === "ready")
    return { label: "Plan ready to review", nextAction: "Review Pending Changes" };
  if (state.analysis.findings.length === 0) return { label: "Clean", nextAction: "Scan now" };
  return {
    label: `${state.analysis.findings.length} open finding(s)`,
    nextAction: "Review findings",
  };
}
