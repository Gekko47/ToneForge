import { describe, expect, it } from "vitest";
import * as ChangePlanning from "../../../src/changes";
import type { PlanOptions } from "../../../src/changes/planner";

describe("changes public barrel", () => {
  it("exports planner, conflict, and stale-guard contracts", () => {
    expect(ChangePlanning.planChanges).toBeTypeOf("function");
    expect(ChangePlanning.createChangePlanFromFindings).toBeTypeOf("function");
    expect(ChangePlanning.detectConflicts).toBeTypeOf("function");
    expect(ChangePlanning.isStale).toBeTypeOf("function");
    expect(ChangePlanning.markStale).toBeTypeOf("function");
    expect(ChangePlanning.createChangePlanFromFindings).toBe(ChangePlanning.planChanges);
  });

  it("exports the planner options type for consumers", () => {
    const options: PlanOptions = {
      findings: [],
      docHash: "document-hash",
      baseDocId: "document-id",
    };

    expect(ChangePlanning.planChanges(options)).toMatchObject({
      docHash: "document-hash",
      baseDocId: "document-id",
    });
  });
});
