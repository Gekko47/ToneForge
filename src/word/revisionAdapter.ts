/**
 * Sole mutation path: ChangePlan -> Word revisions.
 * Rules and UI never call Office directly; they go through this adapter.
 */

import { runInWord } from "../shared/office/officeHelpers";
import { type ChangePlan } from "../core/domain/ChangePlan";
import { type Change } from "../core/domain/Change";
import { logger } from "../shared/utils/logger";

export interface RevisionResult {
  changeId: string;
  applied: boolean;
  error?: string;
}

/**
 * Apply a ChangePlan to the live Word document.
 * Each change is attempted independently; failures are collected, never fatal.
 */
export async function applyChangePlan(plan: ChangePlan): Promise<RevisionResult[]> {
  const results: RevisionResult[] = [];
  for (const change of plan.changes) {
    try {
      await applySingleChange(change);
      results.push({ changeId: change.id, applied: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed to apply change", { changeId: change.id, message });
      results.push({ changeId: change.id, applied: false, error: message });
    }
  }
  return results;
}

async function applySingleChange(change: Change): Promise<void> {
  await runInWord(async (context) => {
    const selection = context.document.getSelection();
    switch (change.type) {
      case "insertText":
        selection.insertText(String(change.payload.text ?? ""), "Replace");
        break;
      case "replaceText":
        selection.insertText(String(change.payload.text ?? ""), "Replace");
        break;
      case "deleteRange":
        selection.insertText("", "Replace");
        break;
      case "setParagraphFormat":
        selection.paragraphs.load("format");
        await context.sync();
        break;
      case "setCharacterFormat":
        selection.font.load("name", "size", "color");
        await context.sync();
        break;
      case "applyStyle":
        break;
      case "insertBreak":
        selection.insertBreak(Office.InsertBreakBehavior.Paragraph);
        break;
      case "setListLevel":
        break;
      default:
        throw new Error(`Unsupported change type: ${(change as { type: string }).type}`);
    }
    await context.sync();
  });
}

export function validatePlanBeforeApply(plan: ChangePlan): string[] {
  const problems: string[] = [];
  if (!plan.docHash || plan.docHash.trim().length === 0) {
    problems.push("ChangePlan.docHash is required");
  }
  if (plan.changes.length === 0) {
    problems.push("ChangePlan has no changes");
  }
  return problems;
}
