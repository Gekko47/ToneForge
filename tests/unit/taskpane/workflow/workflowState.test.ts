import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  createWorkflowState,
  selectCurrentTask,
  selectNextFindingIndex,
  selectPreviousFindingIndex,
  workflowReducer,
} from "../../../../src/taskpane/workflow/workflowState";
import type { Finding } from "../../../../src/core/domain/Finding";
import type { WorkflowAction } from "../../../../src/taskpane/workflow/workflowState";

function finding(id: string): Finding {
  return {
    id,
    kind: "deterministic",
    category: "typography.emDash",
    range: { start: 0, end: 1, unit: "character" },
    message: "Use an em dash",
    severity: "warning",
    evidence: "--",
    nodeIds: [],
    source: "deterministic",
    status: "new",
    confidence: 1,
    risk: "none",
    reversible: true,
  };
}

function reduceAll(): ReturnType<typeof createWorkflowState> {
  const initial = createWorkflowState();
  const actions: WorkflowAction[] = [
    { type: "document/context", documentId: "doc", version: "1", capabilityTier: "api-present" },
    { type: "analysis/policy", profileId: uuidv4(), policyRevision: 3 },
    { type: "analysis/scan", scanStatus: "scanning" },
    { type: "analysis/findings", findings: [finding(uuidv4()), finding(uuidv4())] },
    { type: "analysis/scan", scanStatus: "fresh" },
  ];
  return actions.reduce(workflowReducer, initial);
}

describe("workflowState", () => {
  it("projects document, analysis, plan, and apply state from one store", () => {
    let state = reduceAll();
    expect(state.document.capabilityTier).toBe("api-present");
    expect(state.analysis.policyRevision).toBe(3);
    expect(state.analysis.findings).toHaveLength(2);
    expect(selectCurrentTask(state).nextAction).toBe("Review findings");

    state = workflowReducer(state, { type: "plan/ready", planId: uuidv4(), conflictCount: 0 });
    expect(selectCurrentTask(state).nextAction).toBe("Review Pending Changes");

    state = workflowReducer(state, { type: "apply/status", status: "verified", message: "ok" });
    expect(state.apply.status).toBe("verified");
  });

  it("supports finding previous/next navigation and reject", () => {
    let state = reduceAll();
    expect(selectNextFindingIndex(state)).toBe(0);
    state = workflowReducer(state, { type: "plan/selectFinding", index: 0 });
    expect(selectNextFindingIndex(state)).toBe(1);
    expect(selectPreviousFindingIndex(state)).toBe(1);
    expect(
      selectPreviousFindingIndex({
        ...state,
        planReview: { ...state.planReview, selectedFindingIndex: 1 },
      }),
    ).toBe(0);

    state = workflowReducer(state, { type: "plan/reject" });
    expect(state.planReview.status).toBe("rejected");
    expect(state.planReview.planId).toBeNull();
    expect(state.apply.message).toContain("Nothing was applied");
  });

  it("tracks selection context and troubleshooting errors", () => {
    let state = createWorkflowState();
    state = workflowReducer(state, {
      type: "document/selection",
      selection: { text: "abc", start: 4, end: 7 },
    });
    expect(state.document.selection?.text).toBe("abc");
    state = workflowReducer(state, { type: "troubleshooting/error", message: "probe failed" });
    expect(state.troubleshooting.lastError).toBe("probe failed");
  });
});
