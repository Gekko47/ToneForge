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
import { ChangePlanSchema, type ChangePlan } from "../core/domain/ChangePlan";
import { type Change, type ChangeRange } from "../core/domain/Change";
import { matchesChangePrecondition, validateChangePreconditions } from "../changes/preconditions";
import { logger } from "../shared/utils/logger";
import { type WordCapabilities } from "./capabilityProbe";
import { isProtectedNode } from "../rules/protection";
import type { DocumentNode } from "../core/domain/DocumentSnapshot";

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
    | "supportsInsertText"
    | "supportsReplaceText"
    | "supportsInsertBreak"
    | "supportsStyles"
    | "supportsParagraphFormat"
    | "supportsCharacterFormat"
    | "supportsResetCharacterFormatting"
    | "supportsListLevel"
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

function orderChanges(changes: readonly Change[]): Change[] {
  const byId = new Map(changes.map((change) => [change.id, change]));
  const remaining = [...changes];
  const ordered: Change[] = [];
  const applied = new Set<string>();
  while (remaining.length > 0) {
    const ready = remaining
      .filter((change) =>
        (change.dependsOn ?? []).every(
          (dependency) => applied.has(dependency) || !byId.has(dependency),
        ),
      )
      .sort(
        (left, right) => right.range.start - left.range.start || right.range.end - left.range.end,
      );
    const next = ready[0];
    if (!next) return [...changes].sort((left, right) => right.range.start - left.range.start);
    ordered.push(next);
    applied.add(next.id);
    remaining.splice(remaining.indexOf(next), 1);
  }
  return ordered;
}

function preservationLiterals(text: string): string[] {
  const matches =
    text.match(/(?:https?:\/\/\S+|\b\d{4}-\d{2}-\d{2}\b|\b\d+(?:\.\d+)?%?\b|\b[A-Z]{2,}\b)/g) ?? [];
  return Array.from(new Set(matches));
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
 * earlier text is inserted or deleted. Conflicting plans are refused by
 * default (Stage 22 safety gate); the caller may pass allowConflicts: true
 * only after explicitly reviewing the conflict list on the plan.
 */
export async function applyChangePlan(
  plan: ChangePlan,
  currentDocHash: string,
  allowConflicts = false,
  nodes?: readonly DocumentNode[],
  currentGovernancePolicyRevision?: number,
): Promise<RevisionResult[]> {
  const results: RevisionResult[] = [];
  const parsedPlan = ChangePlanSchema.safeParse(plan);
  if (!parsedPlan.success) {
    const message = `ChangePlan schema is incompatible: ${parsedPlan.error.issues.map((issue) => issue.message).join("; ")}`;
    return plan.changes.map((change) => ({ changeId: change.id, applied: false, error: message }));
  }
  const problems = validatePlanBeforeApply(
    parsedPlan.data,
    allowConflicts,
    nodes,
    currentGovernancePolicyRevision,
  );

  if (!currentDocHash || currentDocHash.trim().length === 0) {
    problems.push("currentDocHash is required");
  }

  if (problems.length > 0) {
    const category: RefusalCategory = plan.stale
      ? "stale_complete_identity"
      : (plan.conflicts ?? []).length > 0
        ? "conflict"
        : plan.changes.some(
              (change) => change.approvalRequired && change.approvalState !== "approved",
            )
          ? "approval_required"
          : "local_precondition_failed";
    logger.warn("ChangePlan validation failed", {
      planId: plan.id,
      problems,
      refusalCategory: category,
      governancePolicyRevision: plan.governancePolicyRevision,
      verificationResult: "refused",
    });
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
      refusalCategory: "stale_complete_identity",
      governancePolicyRevision: plan.governancePolicyRevision,
      verificationResult: "refused",
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

  const orderedChanges = orderChanges(plan.changes);
  const preconditionResults: Array<{
    change: Change;
    matches: boolean;
    reason?: string;
  }> = [];
  for (const change of orderedChanges) {
    try {
      preconditionResults.push({ change, ...(await verifyLivePrecondition(change)) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      preconditionResults.push({ change, matches: false, reason: message });
    }
  }
  const failedPreconditions = preconditionResults.filter((result) => !result.matches);
  if (failedPreconditions.length > 0) {
    logger.warn("Atomic precondition preflight failed; refusing the entire plan", {
      planId: plan.id,
      changeIds: failedPreconditions.map((result) => result.change.id),
      refusalCategory: "local_precondition_failed",
      governancePolicyRevision: plan.governancePolicyRevision,
      verificationResult: "refused",
    });
    return plan.changes.map((change) => {
      const failure = failedPreconditions.find((result) => result.change.id === change.id);
      return {
        changeId: change.id,
        applied: false,
        error: failure
          ? `Atomic precondition preflight failed: ${failure.reason ?? "unknown mismatch"}`
          : "Atomic precondition preflight failed because another change target is stale.",
      };
    });
  }

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
 * Production application is fail-closed: if the host does not expose a
 * controllable tracking mode, no mutation is attempted. The previous mode is
 * restored after the plan, and the result includes the observed revision
 * count when Word exposes it.
 */
export async function applyChangePlanWithTracking(
  plan: ChangePlan,
  currentDocHash: string,
  allowConflicts = false,
  nodes?: readonly DocumentNode[],
  currentGovernancePolicyRevision?: number,
): Promise<ApplyWithTrackingResult> {
  const parsed = ChangePlanSchema.safeParse(plan);
  const refusalProblems = parsed.success
    ? validatePlanBeforeApply(plan, allowConflicts, nodes, currentGovernancePolicyRevision)
    : ["ChangePlan schema is incompatible"];
  if (refusalProblems.length > 0) {
    return {
      results: plan.changes.map((change) => ({
        changeId: change.id,
        applied: false,
        error: `Plan validation failed: ${refusalProblems.join("; ")}`,
      })),
      tracking: { managed: false },
    };
  }
  const enablement = await enableRevisionTracking();
  if (!enablement.managed) {
    return {
      results: plan.changes.map((change) => ({
        changeId: change.id,
        applied: false,
        error: "Managed Track Changes could not be established; no changes were applied.",
      })),
      tracking: { managed: false },
    };
  }
  const results = await applyChangePlan(
    plan,
    currentDocHash,
    allowConflicts,
    nodes,
    currentGovernancePolicyRevision,
  );
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
        const range = await getRangeByChange(context, change.range);
        range.insertText(String(change.payload.text), "Replace");
        break;
      }
      case "replaceText": {
        requireVerifiedCapability(change.id, "supportsReplaceText", "replaceText");
        const range = await getRangeByChange(context, change.range);
        range.insertText(String(change.payload.text), "Replace");
        break;
      }
      case "deleteRange": {
        requireVerifiedCapability(change.id, "supportsReplaceText", "deleteRange");
        const range = await getRangeByChange(context, change.range);
        range.insertText("", "Replace");
        break;
      }
      case "setParagraphFormat": {
        const range = await getRangeByChange(context, change.range);
        requireVerifiedCapability(change.id, "supportsParagraphFormat", "setParagraphFormat");
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
          const paragraphFormatWithSpacing = paragraphFormat as unknown as {
            set?: (properties: Record<string, unknown>) => unknown;
          };
          if (typeof paragraphFormatWithSpacing.set !== "function") {
            throw new Error("setParagraphFormat line spacing is not supported in this host");
          }
          paragraphFormatWithSpacing.set({ lineSpacing: change.payload.lineSpacing });
        }

        if (change.payload.listLevel !== undefined) {
          const listFormat = range.listFormat as unknown as {
            set?: (properties: Record<string, unknown>) => unknown;
          };
          if (typeof listFormat.set !== "function") {
            throw new Error("setParagraphFormat list level is not supported in this host");
          }
          listFormat.set({ listLevelNumber: change.payload.listLevel });
        }
        break;
      }
      case "setCharacterFormat": {
        const range = await getRangeByChange(context, change.range);
        requireVerifiedCapability(change.id, "supportsCharacterFormat", "setCharacterFormat");
        range.font.set(change.payload);
        break;
      }
      case "resetCharacterFormatting": {
        const range = await getRangeByChange(context, change.range);
        requireVerifiedCapability(
          change.id,
          "supportsResetCharacterFormatting",
          "resetCharacterFormatting",
        );
        if (typeof range.font.reset !== "function") {
          throw new Error("resetCharacterFormatting is not supported in this host");
        }
        range.font.reset();
        break;
      }
      case "applyStyle": {
        // Desktop Stage 01 did not verify style application, so callers must
        // provide a positive capability result before this path is reachable.
        requireVerifiedCapability(change.id, "supportsStyles", "applyStyle");
        const range = await getRangeByChange(context, change.range);
        const styleName = change.payload.styleName;
        if (typeof styleName !== "string" || !styleName.trim()) {
          throw new Error("applyStyle requires payload.styleName");
        }
        range.style = styleName;
        break;
      }
      case "insertBreak": {
        requireVerifiedCapability(change.id, "supportsInsertBreak", "insertBreak");
        const range = await getRangeByChange(context, change.range);
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
        const range = await getRangeByChange(context, change.range);
        requireVerifiedCapability(change.id, "supportsListLevel", "setListLevel");
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
async function getRangeByChange(
  context: Office.Context,
  range: ChangeRange,
): Promise<Office.Range> {
  const body = context.document.body;
  const target = range.target ?? { kind: "document" as const };
  body.load("text");
  await context.sync();
  const text = body.text ?? "";
  if (range.start < 0 || range.end > text.length || range.start > range.end) {
    throw new Error(
      `Range [${range.start}, ${range.end}] is out of bounds for document of length ${text.length}`,
    );
  }
  if (range.unit === "paragraph") {
    if (range.end !== range.start + 1) {
      throw new Error(
        `Multi-paragraph range [${range.start}, ${range.end}] is not supported; planning must create one change per paragraph`,
      );
    }
    const paragraphs = body.paragraphs;
    if (!paragraphs) throw new Error("Paragraph-unit target requires Word paragraph collection");
    paragraphs.load("items");
    await context.sync();
    const item = paragraphs.items[target.kind === "paragraph" ? target.index : -1];
    if (!item) throw new Error(`Paragraph target ${range.start} is unavailable`);
    const getRange = (item as unknown as { getRange?: (location: "Whole") => Office.Range })
      .getRange;
    if (typeof getRange !== "function") {
      throw new Error("Word host does not expose Paragraph.getRange('Whole')");
    }
    return getRange.call(item, "Whole");
  }
  if (range.unit === "section") {
    throw new Error("Section-unit changes are not yet resolvable by the Word adapter");
  }
  const whole = body.getRange("Whole");
  whole.set({ start: range.start, end: range.end });
  return whole;
}

async function verifyLivePrecondition(
  change: Change,
): Promise<{ matches: boolean; reason?: string }> {
  const precondition = change.precondition;
  if (precondition === undefined) return { matches: true };
  return runInWord(async (context) => {
    const body = context.document.body;
    body.load("text");
    const paragraphs = body.paragraphs;
    if (precondition.kind === "text") {
      await context.sync();
      return matchesChangePrecondition(change, {
        text: (body.text ?? "").slice(change.range.start, change.range.end),
      });
    }
    if (!paragraphs) {
      return matchesChangePrecondition(change, {});
    }
    paragraphs.load("items");
    await context.sync();
    const target = change.range.target ?? { kind: "document" as const };
    const index = target.kind === "paragraph" ? target.index : -1;
    const paragraph = paragraphs.items[index] as unknown as
      | {
          text?: string;
          uniqueLocalId?: string;
          style?: string | { name?: string };
          alignment?: string;
          lineSpacing?: number;
          spaceAfter?: number;
          spaceBefore?: number;
          font?: {
            name?: string;
            size?: number;
            color?: string;
            bold?: boolean;
            italic?: boolean;
            underline?: boolean;
          };
          listItem?: { level?: number };
          load?: (properties: string | string[]) => unknown;
        }
      | undefined;
    if (!paragraph) return matchesChangePrecondition(change, {});
    paragraph.load?.([
      "text",
      "uniqueLocalId",
      "style",
      "alignment",
      "lineSpacing",
      "spaceAfter",
      "spaceBefore",
      "font",
    ]);
    await context.sync();
    const styleName =
      typeof paragraph.style === "string"
        ? paragraph.style
        : typeof paragraph.style?.name === "string"
          ? paragraph.style.name
          : undefined;
    const liveNodeId =
      typeof paragraph.uniqueLocalId === "string" && paragraph.uniqueLocalId.trim().length > 0
        ? `word-paragraph-${paragraph.uniqueLocalId.trim()}`
        : undefined;
    return matchesChangePrecondition(change, {
      ...(typeof paragraph.text === "string" ? { text: paragraph.text } : {}),
      ...(liveNodeId === undefined ? {} : { nodeId: liveNodeId }),
      ...(styleName === undefined ? {} : { styleName }),
      formatting: {
        ...(styleName === undefined ? {} : { styleName }),
        alignment: normalizeLiveAlignment(paragraph.alignment),
        lineSpacing: paragraph.lineSpacing ?? null,
        spaceAfter: paragraph.spaceAfter ?? null,
        spaceBefore: paragraph.spaceBefore ?? null,
        listLevel: null,
        fontName: paragraph.font?.name ?? null,
        fontSize: paragraph.font?.size ?? null,
        fontColor: paragraph.font?.color ?? null,
        bold: paragraph.font?.bold ?? null,
        italic: paragraph.font?.italic ?? null,
        underline: paragraph.font?.underline ?? null,
      },
    });
  });
}

function normalizeLiveAlignment(value: unknown): "left" | "center" | "right" | "justified" | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return normalized === "centered"
    ? "center"
    : normalized === "left" || normalized === "right" || normalized === "justified"
      ? normalized
      : null;
}

export type RefusalCategory =
  | "stale_complete_identity"
  | "local_precondition_failed"
  | "protected_node"
  | "unsupported_capability"
  | "unresolved_semantic_span"
  | "partial_coverage"
  | "approval_required"
  | "conflict";

export interface RefusalDiagnostic {
  category: RefusalCategory;
  planId: string;
  changeId?: string;
  governancePolicyRevision?: number;
  verificationResult: "refused" | "applied_verified" | "verification_failed";
}

export function validatePlanBeforeApply(
  plan: ChangePlan,
  allowConflicts = false,
  nodes?: readonly DocumentNode[],
  currentGovernancePolicyRevision?: number,
): string[] {
  const problems: string[] = [];
  if (
    plan.governancePolicyRevision !== undefined &&
    currentGovernancePolicyRevision === undefined
  ) {
    problems.push("Current governance policy revision is required to apply a governed plan");
  } else if (
    plan.governancePolicyRevision !== undefined &&
    currentGovernancePolicyRevision !== undefined &&
    plan.governancePolicyRevision !== currentGovernancePolicyRevision
  ) {
    problems.push(
      `Governance policy revision mismatch: plan ${plan.governancePolicyRevision}, current ${currentGovernancePolicyRevision}`,
    );
  }
  if (plan.schemaVersion !== 2) {
    problems.push("ChangePlan schemaVersion must be 2; legacy or unknown plans are refused");
  }
  if (!plan.docHash || plan.docHash.trim().length === 0) {
    problems.push("ChangePlan.docHash is required");
  }
  if (plan.changes.length === 0) {
    problems.push("ChangePlan has no changes");
  }
  if (plan.stale) {
    problems.push("ChangePlan is stale; re-plan before applying");
  }
  if ((plan.conflicts ?? []).length > 0 && !allowConflicts) {
    problems.push(
      `ChangePlan has ${(plan.conflicts ?? []).length} unresolved conflict(s); review before applying`,
    );
  }
  if (plan.schemaVersion === 2) {
    problems.push(...validateChangePreconditions(plan.changes));
    plan.changes.forEach((change) => {
      if (change.approvalRequired && change.approvalState !== "approved") {
        problems.push(`Change ${change.id} requires explicit approval`);
      }
    });
  }
  const changeIds = new Set(plan.changes.map((change) => change.id));
  plan.changes.forEach((change) => {
    (change.dependsOn ?? []).forEach((dependency) => {
      if (!changeIds.has(dependency))
        problems.push(`Change ${change.id} depends on missing change ${dependency}`);
    });
  });
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

  // Second layer: protection and preservation checks.
  if (nodes && nodes.length > 0) {
    const findingsById = new Map((plan.findings ?? []).map((finding) => [finding.id, finding]));
    plan.changes.forEach((change) => {
      const finding = change.findingId ? findingsById.get(change.findingId) : undefined;
      const targetIds = new Set(finding?.nodeIds ?? []);
      const protectedNode = nodes.find(
        (node) => targetIds.has(node.nodeId) && (!node.editable || isProtectedNode(node)),
      );
      if (protectedNode) {
        problems.push(
          `Change ${change.id} targets protected range: ${protectedNode.protectionReason ?? protectedNode.type}`,
        );
      }
    });
  }
  plan.changes.forEach((change) => {
    const finding = (plan.findings ?? []).find((item) => item.id === change.findingId);
    if (finding?.actual && finding.expected) {
      const missing = preservationLiterals(finding.actual).filter(
        (literal) => !finding.expected?.includes(literal),
      );
      if (missing.length > 0) {
        problems.push(`Change ${change.id} would remove preserved content: ${missing.join(", ")}`);
      }
    }
  });

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
    case "resetCharacterFormatting":
      if (Object.keys(payload).length > 0) {
        return "resetCharacterFormatting does not accept a payload";
      }
      return undefined;
    case "setListLevel":
      if (
        typeof payload["level"] !== "number" ||
        !Number.isInteger(payload["level"]) ||
        payload["level"] < 0 ||
        payload["level"] > 8
      ) {
        return "setListLevel requires an integer payload.level from 0 through 8";
      }
      return undefined;
    default:
      return undefined;
  }
}
