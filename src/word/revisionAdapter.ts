/**
 * Sole mutation path: ChangePlan -> Word revisions.
 * Rules and UI never call Office directly; they go through this adapter.
 *
 * BLOCKED: Stage 18 is gated on Stage 01 PASS (probeWordCapabilities must
 * return supportsRevisions: true or document the limitation). Until that
 * gate closes, applyChangePlan() refuses to mutate and reports applied: false
 * for every change. This prevents silent success on unproven revision behavior.
 */

import { runInWord } from "../shared/office/officeHelpers";
import { type ChangePlan } from "../core/domain/ChangePlan";
import { type Change } from "../core/domain/Change";
import { logger } from "../shared/utils/logger";

/** Set to true only after Stage 01 probe passes in Word. */
export let STAGE_01_PASSED = false;

export function setStage01Passed(passed: boolean): void {
  STAGE_01_PASSED = passed;
}

export interface RevisionResult {
  changeId: string;
  applied: boolean;
  error?: string;
}

/**
 * Apply a ChangePlan to the live Word document.
 * Each change is attempted independently; failures are collected, never fatal.
 *
 * Before any mutation, the live document hash is compared against the
 * ChangePlan's recorded docHash. If they differ the plan is stale and
 * application is refused — this prevents silent corruption when the
 * document has been edited since the plan was created.
 */
export async function applyChangePlan(
  plan: ChangePlan,
  currentDocHash?: string,
): Promise<RevisionResult[]> {
  const results: RevisionResult[] = [];

  if (!STAGE_01_PASSED) {
    logger.warn("Stage 01 gate not passed; refusing to apply ChangePlan", {
      planId: plan.id,
    });
    for (const change of plan.changes) {
      results.push({
        changeId: change.id,
        applied: false,
        error: "Stage 01 Office.js capability probe has not passed; mutation blocked",
      });
    }
    return results;
  }

  const problems = validatePlanBeforeApply(plan);
  if (problems.length > 0) {
    logger.warn("ChangePlan validation failed", { planId: plan.id, problems });
    for (const change of plan.changes) {
      results.push({
        changeId: change.id,
        applied: false,
        error: `Plan validation failed: ${problems.join("; ")}`,
      });
    }
    return results;
  }

  // docHash equality check: if the caller provides a current hash, it must
  // match the plan's recorded hash. A mismatch means the document changed
  // after the plan was created — applying would corrupt the document.
  if (currentDocHash !== undefined && currentDocHash !== plan.docHash) {
    logger.warn("Document hash mismatch; refusing to apply ChangePlan", {
      planId: plan.id,
      expected: plan.docHash,
      actual: currentDocHash,
    });
    for (const change of plan.changes) {
      results.push({
        changeId: change.id,
        applied: false,
        error: `Document hash mismatch: expected ${plan.docHash}, got ${currentDocHash}`,
      });
    }
    return results;
  }

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
    switch (change.type) {
      case "insertText": {
        const range = await getRangeByOffset(context, change.range);
        range.insertText(String(change.payload.text ?? ""), "Replace");
        break;
      }
      case "replaceText": {
        const range = await getRangeByOffset(context, change.range);
        range.insertText(String(change.payload.text ?? ""), "Replace");
        break;
      }
      case "deleteRange": {
        const range = await getRangeByOffset(context, change.range);
        range.insertText("", "Replace");
        break;
      }
      case "setParagraphFormat": {
        const range = await getRangeByOffset(context, change.range);
        const paragraphs = range.paragraphs;
        paragraphs.load("format");
        await context.sync();
        const format = (paragraphs as unknown as { format?: Record<string, unknown> }).format;
        if (format && change.payload) {
          Object.assign(format, change.payload);
        }
        break;
      }
      case "setCharacterFormat": {
        const range = await getRangeByOffset(context, change.range);
        range.font.load("name", "size", "color", "bold", "italic", "underline");
        await context.sync();
        if (change.payload) {
          const payload = change.payload as Record<string, unknown>;
          if (typeof payload.name === "string")
            (range.font as { name: string }).name = payload.name;
          if (typeof payload.size === "number")
            (range.font as { size: number }).size = payload.size;
          if (typeof payload.color === "string")
            (range.font as { color: string }).color = payload.color;
          if (typeof payload.bold === "boolean")
            (range.font as { bold: boolean }).bold = payload.bold;
          if (typeof payload.italic === "boolean")
            (range.font as { italic: boolean }).italic = payload.italic;
          if (typeof payload.underline === "boolean")
            (range.font as { underline: boolean }).underline = payload.underline;
        }
        break;
      }
      case "applyStyle": {
        await getRangeByOffset(context, change.range);
        const styleName = change.payload.styleName;
        if (typeof styleName !== "string" || !styleName.trim()) {
          throw new Error("applyStyle requires payload.styleName");
        }
        const styles = context.document.styles;
        styles.load("name");
        await context.sync();
        // Apply via style object if available; otherwise throw unsupported.
        const styleObj = (
          styles as unknown as { items: Array<{ name: string; apply?: () => void }> }
        ).items.find((s) => s.name === styleName);
        if (!styleObj || typeof styleObj.apply !== "function") {
          throw new Error(`Style "${styleName}" not found or not applicable`);
        }
        styleObj.apply();
        break;
      }
      case "insertBreak": {
        const range = await getRangeByOffset(context, change.range);
        range.insertBreak(Office.InsertBreakBehavior.Paragraph);
        break;
      }
      case "setListLevel": {
        const range = await getRangeByOffset(context, change.range);
        const paragraphs = range.paragraphs;
        paragraphs.load("format");
        await context.sync();
        const level = change.payload.level;
        if (typeof level !== "number") {
          throw new Error("setListLevel requires payload.level as number");
        }
        // Word JS: paragraph.format.setListLevel is available in newer hosts.
        const format = (
          paragraphs as unknown as { format?: { setListLevel?: (n: number) => void } }
        ).format;
        if (!format || typeof format.setListLevel !== "function") {
          throw new Error("setListLevel not supported in this host");
        }
        format.setListLevel(level);
        break;
      }
      default:
        throw new Error(`Unsupported change type: ${(change as { type: string }).type}`);
    }
    await context.sync();
  });
}

/**
 * Resolve a Range by character offset within the document body.
 * Uses body.search to find the range at the given offset.
 */
async function getRangeByOffset(
  context: Office.Context,
  range: { start: number; end: number },
): Promise<Office.Range> {
  const body = context.document.body;
  body.load("text");
  await context.sync();
  const text = body.text ?? "";
  if (range.start < 0 || range.end > text.length || range.start > range.end) {
    throw new Error(
      `Range [${range.start}, ${range.end}] is out of bounds for document of length ${text.length}`,
    );
  }
  // Use getRange to obtain a Range at the offset.
  const bodyWithGetRange = body as unknown as {
    getRange: (start: number, length: number) => Office.Range;
  };
  return bodyWithGetRange.getRange(range.start, range.end - range.start);
}

export function validatePlanBeforeApply(plan: ChangePlan): string[] {
  const problems: string[] = [];
  if (!plan.docHash || plan.docHash.trim().length === 0) {
    problems.push("ChangePlan.docHash is required");
  }
  if (plan.changes.length === 0) {
    problems.push("ChangePlan has no changes");
  }
  if (plan.stale) {
    problems.push("ChangePlan is stale; re-plan before applying");
  }
  return problems;
}
