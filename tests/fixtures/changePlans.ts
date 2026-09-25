import type { Change } from "../../src/core/domain/Change";
import { createChangePlan, type ChangePlan } from "../../src/core/domain/ChangePlan";

/**
 * Build a schema-v2 test plan whose preconditions describe the supplied source text.
 * Individual changes may override the precondition when the test exercises a
 * specific mismatch or non-text target.
 */
export function createTestPlan(
  docHash: string,
  baseDocId: string,
  changes: Change[],
  documentText = "hello world",
): ChangePlan {
  const contractChanges: Change[] = changes.map((change) => ({
    ...change,
    approvalRequired: change.approvalRequired ?? false,
    approvalState:
      change.approvalState ??
      (change.approvalRequired ? ("approved" as const) : ("notRequired" as const)),
    precondition:
      change.precondition ??
      ({
        kind: "text",
        expectedText: documentText.slice(change.range.start, change.range.end),
      } as const),
  }));

  return createChangePlan(docHash, baseDocId, contractChanges, [], { schemaVersion: 2 });
}
