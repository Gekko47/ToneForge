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
import { type WordCapabilities } from "./capabilityProbe";

/** Set to true only after the Stage 01 probe passes in Word. */
export let STAGE_01_PASSED = false;
let STAGE_01_CAPABILITIES: WordCapabilities | undefined;

export function setStage01Passed(passed: boolean, capabilities?: WordCapabilities): void {
  if (passed && capabilities === undefined) {
    throw new Error("setStage01Passed(true) requires a verified WordCapabilities snapshot");
  }
  STAGE_01_PASSED = passed;
  STAGE_01_CAPABILITIES = passed ? capabilities : undefined;
}

function requireVerifiedCapability(
  changeId: string,
  capability: keyof Pick<
    WordCapabilities,
    "supportsInsertText" | "supportsReplaceText" | "supportsInsertBreak" | "supportsStyles"
  >,
  changeLabel: string,
): void {
  if (STAGE_01_CAPABILITIES === undefined) {
    throw new Error(
      `${changeLabel} requires a verified Stage 01 capability snapshot (change ${changeId})`,
    );
  }
  if (STAGE_01_CAPABILITIES[capability] === false) {
    throw new Error(
      `${changeLabel} is not supported by the verified Stage 01 host (change ${changeId})`,
    );
  }
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
 * Before any mutation, the caller must provide the current live document hash.
 * It is compared against the ChangePlan's recorded docHash. A missing or
 * differing hash refuses application and prevents silent corruption when the
 * document has changed since the plan was created.
 *
 * Changes are applied from the end of the original document toward the start.
 * This preserves the planner's original offsets for non-overlapping changes as
 * earlier text is inserted or deleted. Conflicting plans remain a Stage 22
 * safety concern and are not resolved by this adapter.
 */
export async function applyChangePlan(
  plan: ChangePlan,
  currentDocHash: string,
): Promise<RevisionResult[]> {
  const results: RevisionResult[] = [];
  const problems = validatePlanBeforeApply(plan);

  if (!currentDocHash || currentDocHash.trim().length === 0) {
    problems.push("currentDocHash is required");
  }

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

  if (currentDocHash !== plan.docHash) {
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

  const orderedChanges = [...plan.changes].sort(
    (left, right) => right.range.start - left.range.start || right.range.end - left.range.end,
  );

  for (const change of orderedChanges) {
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

export interface TrackingReport {
  /** True when the adapter could read and control the tracking mode. */
  managed: boolean;
  /** Tracking mode observed before applying (`Off` | `TrackAll` | `TrackMineOnly`). */
  modeBefore?: string;
  /** Tracking mode left behind after restore (absent when restore failed). */
  modeAfter?: string;
  /** Tracked-revision count observed after applying (WordApi 1.6 only). */
  recordedCount?: number;
}

export interface ApplyWithTrackingResult {
  results: RevisionResult[];
  tracking: TrackingReport;
}

/**
 * Apply a ChangePlan with revision tracking managed around the mutations.
 *
 * When the host exposes tracking control (`Document.changeTrackingMode`,
 * WordApi 1.4, or `Document.trackRevisions`, WordApiDesktop 1.4), tracking is
 * switched on for the current user (`TrackMineOnly`, "Just Me") before the
 * first change and restored afterwards, so every applied change is natively
 * recorded as a tracked revision. The per-change `RevisionResult[]` is still
 * the tool's record of what it changed.
 *
 * When tracking control is unavailable, edits are applied normally and
 * reported as `tracking.managed: false` — they are still tracked if the user
 * has Track Changes enabled in the Word UI, but the add-in cannot guarantee
 * or verify it. Failures to enable, restore, or count revisions are never
 * fatal to the plan itself.
 */
export async function applyChangePlanWithTracking(
  plan: ChangePlan,
  currentDocHash: string,
): Promise<ApplyWithTrackingResult> {
  const enablement = await enableRevisionTracking();
  const results = await applyChangePlan(plan, currentDocHash);
  const modeAfter = await restoreRevisionTracking(enablement);
  const recordedCount = enablement.managed ? await countRecordedRevisions() : undefined;
  const tracking: TrackingReport = { managed: enablement.managed };
  if (enablement.modeBefore !== undefined) {
    tracking.modeBefore = enablement.modeBefore;
  }
  if (modeAfter !== undefined) {
    tracking.modeAfter = modeAfter;
  }
  if (recordedCount !== undefined) {
    tracking.recordedCount = recordedCount;
  }
  return { results, tracking };
}

interface DocumentTrackingView {
  load?: (props: string) => void;
  changeTrackingMode?: unknown;
  trackRevisions?: unknown;
}

function trackingDocument(context: Office.Context): DocumentTrackingView {
  return context.document as unknown as DocumentTrackingView;
}

const KNOWN_TRACKING_MODES: readonly string[] = ["Off", "TrackAll", "TrackMineOnly"];

async function readTrackingMode(): Promise<{ mode: string; desktop: boolean } | undefined> {
  try {
    return await runInWord(async (context) => {
      const doc = trackingDocument(context);
      if (typeof doc.load !== "function") return undefined;
      try {
        doc.load("changeTrackingMode");
        await context.sync();
      } catch {
        return undefined;
      }
      if (
        typeof doc.changeTrackingMode === "string" &&
        KNOWN_TRACKING_MODES.includes(doc.changeTrackingMode)
      ) {
        return { mode: doc.changeTrackingMode, desktop: false };
      }
      try {
        doc.load("trackRevisions");
        await context.sync();
      } catch {
        return undefined;
      }
      if (typeof doc.trackRevisions === "boolean") {
        return { mode: doc.trackRevisions ? "TrackAll" : "Off", desktop: true };
      }
      return undefined;
    });
  } catch {
    return undefined;
  }
}

interface TrackingEnablement {
  managed: boolean;
  modeBefore?: string;
  changed: boolean;
  desktop: boolean;
}

async function enableRevisionTracking(): Promise<TrackingEnablement> {
  const read = await readTrackingMode();
  if (read === undefined) return { managed: false, changed: false, desktop: false };
  if (read.mode !== "Off") {
    return { managed: true, modeBefore: read.mode, changed: false, desktop: read.desktop };
  }
  // Enable tracking for the current user only ("Just Me"). This is the least
  // invasive choice in shared documents — it does not start tracking other
  // people's changes — and it still captures every edit this tool applies,
  // because those edits are made through the current user's Word session.
  // The desktop-only trackRevisions boolean has no per-user mode, so it
  // simply turns tracking on.
  try {
    await runInWord(async (context) => {
      const doc = trackingDocument(context);
      if (read.desktop) {
        (doc as { trackRevisions?: unknown }).trackRevisions = true;
      } else {
        (doc as { changeTrackingMode?: unknown }).changeTrackingMode = "TrackMineOnly";
      }
      await context.sync();
    });
    return { managed: true, modeBefore: read.mode, changed: true, desktop: read.desktop };
  } catch (err) {
    logger.warn("Failed to enable revision tracking; applying unmanaged", {
      message: err instanceof Error ? err.message : String(err),
    });
    return { managed: false, modeBefore: read.mode, changed: false, desktop: read.desktop };
  }
}

async function restoreRevisionTracking(state: TrackingEnablement): Promise<string | undefined> {
  if (!state.changed) return state.modeBefore;
  try {
    await runInWord(async (context) => {
      const doc = trackingDocument(context);
      if (state.desktop) {
        (doc as { trackRevisions?: unknown }).trackRevisions = state.modeBefore !== "Off";
      } else {
        (doc as { changeTrackingMode?: unknown }).changeTrackingMode = state.modeBefore;
      }
      await context.sync();
    });
    return state.modeBefore;
  } catch (err) {
    logger.warn("Failed to restore change tracking mode", {
      message: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

async function countRecordedRevisions(): Promise<number | undefined> {
  try {
    return await runInWord(async (context) => {
      const body = context.document.body as unknown as {
        getTrackedChanges?: () => { load?: (props: string) => void; items?: unknown[] };
      };
      if (typeof body.getTrackedChanges !== "function") return undefined;
      const collection = body.getTrackedChanges();
      if (!collection || typeof collection.load !== "function") return undefined;
      collection.load("items");
      await context.sync();
      return Array.isArray(collection.items) ? collection.items.length : undefined;
    });
  } catch {
    return undefined;
  }
}

async function applySingleChange(change: Change): Promise<void> {
  await runInWord(async (context) => {
    switch (change.type) {
      // Stage 01 Desktop Word verified text insertion and replacement. When
      // revision tracking is enabled by the host, these mutations are tracked.
      case "insertText": {
        requireVerifiedCapability(change.id, "supportsInsertText", "insertText");
        const range = await getRangeByOffset(context, change.range);
        range.insertText(String(change.payload.text ?? ""), "Replace");
        break;
      }
      case "replaceText": {
        requireVerifiedCapability(change.id, "supportsReplaceText", "replaceText");
        const range = await getRangeByOffset(context, change.range);
        range.insertText(String(change.payload.text ?? ""), "Replace");
        break;
      }
      case "deleteRange": {
        requireVerifiedCapability(change.id, "supportsReplaceText", "deleteRange");
        const range = await getRangeByOffset(context, change.range);
        range.insertText("", "Replace");
        break;
      }
      case "setParagraphFormat": {
        const range = await getRangeByOffset(context, change.range);
        const paragraphFormat = range.paragraphFormat;
        if (!paragraphFormat) {
          throw new Error("setParagraphFormat is not supported in this host");
        }

        const alignmentByDomain: Record<"left" | "center" | "right" | "justified", string> = {
          left: "left",
          center: "centered",
          right: "right",
          justified: "justified",
        };
        const payload = change.payload as {
          alignment?: "left" | "center" | "right" | "justified";
          lineSpacing?: number;
          listLevel?: number;
          spaceAfter?: number;
          spaceBefore?: number;
        };
        const properties: Record<string, unknown> = {};
        if (payload.alignment) {
          properties.alignment = alignmentByDomain[payload.alignment];
        }
        if (payload.spaceAfter !== undefined) {
          properties.spaceAfter = payload.spaceAfter;
        }
        if (payload.spaceBefore !== undefined) {
          properties.spaceBefore = payload.spaceBefore;
        }
        if (Object.keys(properties).length > 0) {
          paragraphFormat.set(properties);
        }

        if (change.payload.lineSpacing !== undefined) {
          const paragraphs = range.paragraphs as unknown as {
            space1?: () => void;
            space1Pt5?: () => void;
            space2?: () => void;
          };
          if (change.payload.lineSpacing === 1 && paragraphs.space1) {
            paragraphs.space1();
          } else if (change.payload.lineSpacing === 1.5 && paragraphs.space1Pt5) {
            paragraphs.space1Pt5();
          } else if (change.payload.lineSpacing === 2 && paragraphs.space2) {
            paragraphs.space2();
          } else {
            throw new Error(
              "setParagraphFormat supports lineSpacing values 1, 1.5, or 2 in this host",
            );
          }
        }

        if (change.payload.listLevel !== undefined) {
          range.listFormat.set({ listLevelNumber: change.payload.listLevel });
        }
        break;
      }
      case "setCharacterFormat": {
        const range = await getRangeByOffset(context, change.range);
        range.font.set(change.payload);
        break;
      }
      case "applyStyle": {
        // Desktop Stage 01 did not verify style application, so callers must
        // provide a positive capability result before this path is reachable.
        requireVerifiedCapability(change.id, "supportsStyles", "applyStyle");
        const range = await getRangeByOffset(context, change.range);
        const styleName = change.payload.styleName;
        if (typeof styleName !== "string" || !styleName.trim()) {
          throw new Error("applyStyle requires payload.styleName");
        }
        range.style = styleName;
        break;
      }
      case "insertBreak": {
        requireVerifiedCapability(change.id, "supportsInsertBreak", "insertBreak");
        const range = await getRangeByOffset(context, change.range);
        const breakType = (change.payload as { breakType?: "line" | "page" | "nextParagraph" })
          .breakType;
        const enums = resolveBreakEnums(change.id);
        const breakValues: Record<string, Office.BreakType> = {
          line: enums.breakType.LineBreak,
          page: enums.breakType.PageBreak,
          nextParagraph: enums.breakType.NextParagraph,
        };
        const breakValue =
          breakValues[breakType ?? "nextParagraph"] ?? enums.breakType.NextParagraph;
        range.insertBreak(breakValue, enums.insertLocation.After);
        break;
      }
      case "setListLevel": {
        const range = await getRangeByOffset(context, change.range);
        const listFormat = range.listFormat;
        if (!listFormat) {
          throw new Error("setListLevel is not supported in this host");
        }
        listFormat.set({ listLevelNumber: change.payload.level });
        break;
      }
      default:
        throw new Error(`Unsupported change type: ${(change as { type: string }).type}`);
    }
    await context.sync();
  });
}

/**
 * Resolve break enums from the live host at runtime.
 *
 * Live Desktop Word (WebView2, 2026-09-22 diagnostics) exposes
 * `Word.BreakType` / `Word.InsertLocation` while `Office.InsertBreakBehavior`
 * (and `Office.BreakType`, which exists only as a TypeScript namespace
 * merge, not a runtime property) is absent. Reading `Office.BreakType`
 * directly would yield `undefined` and crash `insertBreak` in production.
 * Prefer the `Word` global; fall back to the `Office` test-double values so
 * unit tests keep working without a live host.
 */
function resolveBreakEnums(changeId: string): {
  breakType: {
    NextParagraph: Office.BreakType;
    LineBreak: Office.BreakType;
    PageBreak: Office.BreakType;
  };
  insertLocation: { After: Office.InsertLocation };
} {
  const globals = globalThis as unknown as {
    Word?: {
      BreakType?: {
        NextParagraph: Office.BreakType;
        LineBreak: Office.BreakType;
        PageBreak: Office.BreakType;
      };
      InsertLocation?: { After: Office.InsertLocation };
    };
    Office?: {
      BreakType?: {
        NextParagraph: Office.BreakType;
        LineBreak: Office.BreakType;
        PageBreak: Office.BreakType;
      };
      InsertLocation?: { After: Office.InsertLocation };
    };
  };
  const breakType = globals.Word?.BreakType ?? globals.Office?.BreakType;
  const insertLocation = globals.Word?.InsertLocation ?? globals.Office?.InsertLocation;
  if (!breakType || !insertLocation) {
    throw new Error(`insertBreak enums are unavailable in this host (change ${changeId})`);
  }
  return { breakType, insertLocation };
}

/**
 * Resolve a Range by character offset within the document body.
 *
 * Uses the documented Word JavaScript API: `body.getRange("Whole")` returns
 * a Range covering the entire body, then `range.set({ start, end })`
 * (WordApiDesktop 1.4) narrows it to the planner's character offsets.
 * Bounds are validated against the loaded body text before narrowing so
 * out-of-range plans fail with a clear per-change error instead of a host
 * exception.
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
  const whole = body.getRange("Whole");
  whole.set({ start: range.start, end: range.end });
  return whole;
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
  for (const change of plan.changes) {
    if (
      !Number.isInteger(change.range.start) ||
      !Number.isInteger(change.range.end) ||
      change.range.start < 0 ||
      change.range.end < 0 ||
      change.range.start > change.range.end
    ) {
      problems.push(
        `Change ${change.id} has an invalid range [${change.range.start}, ${change.range.end}]`,
      );
    }
    const payloadProblem = validatePayloadForType(change);
    if (payloadProblem !== undefined) {
      problems.push(`Change ${change.id}: ${payloadProblem}`);
    }
  }
  return problems;
}

function validatePayloadForType(change: Change): string | undefined {
  const payload = change.payload as Record<string, unknown>;
  switch (change.type) {
    case "insertText":
    case "replaceText":
      if (typeof payload["text"] !== "string" || payload["text"].length === 0) {
        return `${change.type} requires a non-empty payload.text`;
      }
      return undefined;
    case "applyStyle":
      if (typeof payload["styleName"] !== "string" || payload["styleName"].trim().length === 0) {
        return "applyStyle requires a non-empty payload.styleName";
      }
      return undefined;
    case "setListLevel":
      if (
        typeof payload["level"] !== "number" ||
        !Number.isInteger(payload["level"]) ||
        payload["level"] < 0
      ) {
        return "setListLevel requires a non-negative integer payload.level";
      }
      return undefined;
    default:
      return undefined;
  }
}
