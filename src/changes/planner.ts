/**
 * Pure finding-to-plan planner.
 *
 * The planner validates findings, creates schema-valid changes, retains the
 * source findings for review and semantic passthrough, detects conflicts, and
 * applies the optional hash guard. It never imports or calls the Word mutation
 * adapter.
 */

import { v4 as uuidv4 } from "uuid";
import {
  ChangeSchema,
  type Change,
  type ChangeRange,
  type ChangeType,
} from "../core/domain/Change";
import { ChangePlanSchema, createChangePlan, type ChangePlan } from "../core/domain/ChangePlan";
import { FindingSchema, type Finding, type Range } from "../core/domain/Finding";
import {
  ELLIPSIS,
  EM_DASH,
  EN_DASH,
  RIGHT_DOUBLE_QUOTE,
  RIGHT_SINGLE_QUOTE,
} from "../shared/utils/text";
import { detectConflicts } from "./conflictDetector";
import { markStale } from "./staleGuard";

export interface PlanOptions {
  findings: Finding[];
  docHash: string;
  baseDocId: string;
  currentDocHash?: string;
}

interface CreateChangeParams {
  type: ChangeType;
  range: ChangeRange;
  payload: Record<string, unknown>;
  rationale: string;
  finding: Finding;
  reversible?: boolean;
}

function toChangeRange(range: Range): ChangeRange {
  return { start: range.start, end: range.end };
}

function makeChange(params: CreateChangeParams): Change {
  return ChangeSchema.parse({
    id: uuidv4(),
    type: params.type,
    range: params.range,
    payload: params.payload,
    rationale: params.rationale,
    reversible: params.reversible ?? true,
    ...(params.finding.suggestedChangeId === undefined
      ? {}
      : { suggestedChangeId: params.finding.suggestedChangeId }),
  });
}

function textChange(finding: Finding, text: string): Change | null {
  if (text.length === 0) {
    if (finding.range.start === finding.range.end) return null;
    return makeChange({
      type: "deleteRange",
      range: toChangeRange(finding.range),
      payload: {},
      rationale: finding.message,
      finding,
      reversible: true,
    });
  }
  const type: ChangeType = finding.range.start === finding.range.end ? "insertText" : "replaceText";
  return makeChange({
    type,
    range: toChangeRange(finding.range),
    payload: { text },
    rationale: finding.message,
    finding,
  });
}

function deleteChange(finding: Finding, reversible = false): Change | null {
  if (finding.range.start === finding.range.end) return null;
  return makeChange({
    type: "deleteRange",
    range: toChangeRange(finding.range),
    payload: {},
    rationale: finding.message,
    finding,
    reversible,
  });
}

function styleChange(finding: Finding, styleName: string): Change | null {
  const trimmed = styleName.trim();
  if (trimmed.length === 0) return null;
  return makeChange({
    type: "applyStyle",
    range: toChangeRange(finding.range),
    payload: { styleName: trimmed },
    rationale: finding.message,
    finding,
  });
}

function listLevelChange(finding: Finding, level: number): Change | null {
  if (!Number.isInteger(level) || level < 0) return null;
  return makeChange({
    type: "setListLevel",
    range: toChangeRange(finding.range),
    payload: { level },
    rationale: finding.message,
    finding,
  });
}

function directFormatChange(finding: Finding): Change {
  const payload: Record<string, unknown> = {};
  if (/\bbold\b/i.test(finding.message)) payload.bold = true;
  if (/\bitalic\b/i.test(finding.message)) payload.italic = true;
  if (/\bunderline\b/i.test(finding.message)) payload.underline = true;

  const fontMatch = /font=([^\s,)]+)/i.exec(finding.message);
  if (fontMatch?.[1] !== undefined) payload.name = fontMatch[1];

  const sizeMatch = /size=(\d+(?:\.\d+)?)pt/i.exec(finding.message);
  if (sizeMatch?.[1] !== undefined) payload.size = Number.parseFloat(sizeMatch[1]);

  const colorMatch = /color=(#[0-9a-f]{3,8})/i.exec(finding.message);
  if (colorMatch?.[1] !== undefined) payload.color = colorMatch[1];

  return makeChange({
    type: "setCharacterFormat",
    range: toChangeRange(finding.range),
    payload,
    rationale: finding.message,
    finding,
  });
}

function quotedReplacement(message: string): string | null {
  const patterns = [
    /Use\s+[“"']([^”"']+)[”"']\s+instead/i,
    /Replace\s+.*?\s+with\s+[“"']([^”"']+)[”"']/i,
    /Change\s+.*?\s+to\s+[“"']([^”"']+)[”"']/i,
  ];
  const match = patterns
    .map((pattern) => pattern.exec(message))
    .find((result): result is RegExpExecArray => result !== null);
  return match?.[1]?.trim() || null;
}

function preferredTerm(message: string): string | null {
  return quotedReplacement(message);
}

function spellingPreferredTerm(message: string): string | null {
  const match = /\bspelling\s+[“"']([^”"']+)[”"']\s+instead\s+of/i.exec(message);
  return match?.[1]?.trim() || null;
}

function headingStyle(message: string): string {
  const previous = /follows\s+[”"']?Heading\s+(\d+)/i.exec(message);
  if (previous?.[1] !== undefined) {
    const previousLevel = Number.parseInt(previous[1], 10);
    if (Number.isInteger(previousLevel) && previousLevel >= 1 && previousLevel < 9) {
      return `Heading ${previousLevel + 1}`;
    }
  }

  const match = /Heading\s+(\d+)/i.exec(message);
  return match?.[1] !== undefined ? `Heading ${match[1]}` : "Heading 1";
}

function typographyReplacement(finding: Finding): string | null {
  const { category, message } = finding;
  switch (category) {
    case "typography.emDash":
      if (/double hyphen \(--\) instead/i.test(message)) return "--";
      if (/plain space/i.test(message)) return " ";
      return EM_DASH;
    case "typography.emDashSpacing":
      if (/tight/i.test(message)) return EM_DASH;
      if (/spaced/i.test(message)) return ` ${EM_DASH} `;
      return null;
    case "typography.enDashSpacing":
      if (/tight/i.test(message)) return EN_DASH;
      if (/spaced/i.test(message)) return ` ${EN_DASH} `;
      return null;
    case "typography.doubleQuotes":
      return /^use curly double quotes/i.test(message) ? RIGHT_DOUBLE_QUOTE : '"';
    case "typography.singleQuotes":
    case "typography.apostrophes":
      return /^use curly/i.test(message) ? RIGHT_SINGLE_QUOTE : "'";
    case "typography.ellipsis":
      if (/^use ellipsis character/i.test(message)) return ELLIPSIS;
      if (/spaced dots/i.test(message)) return ". . .";
      if (/three dots/i.test(message)) return "...";
      return ELLIPSIS;
    case "typography.whitespace":
      if (/trailing space/i.test(message)) return "";
      return " ";
    default:
      return null;
  }
}

function houseStyleReplacement(finding: Finding): string | null {
  switch (finding.category) {
    case "houseStyle.terminology":
      return preferredTerm(finding.message);
    case "houseStyle.spellingVariant":
      return spellingPreferredTerm(finding.message);
    case "houseStyle.capitalization.sentenceCase": {
      const match = /uppercase\s+[“"']([^”"']+)[”"']/i.exec(finding.message);
      return (match?.[1] ?? finding.evidence).toUpperCase();
    }
    case "houseStyle.capitalization.titleCase": {
      const firstCased = /\p{L}/u.exec(finding.evidence);
      if (firstCased === null || firstCased[0] === undefined) return null;
      return firstCased[0].toUpperCase();
    }
    default:
      return null;
  }
}

function semanticChanges(finding: Finding): Change[] {
  const replacement = quotedReplacement(finding.message);
  if (replacement === null) return [];
  if (finding.evidence.length === 0 && finding.range.start !== finding.range.end) return [];
  return [textChange(finding, replacement)].filter((change): change is Change => change !== null);
}

function changesForFinding(finding: Finding): Change[] {
  switch (finding.category) {
    case "typography.emDash":
    case "typography.emDashSpacing":
    case "typography.enDashSpacing":
    case "typography.doubleQuotes":
    case "typography.singleQuotes":
    case "typography.apostrophes":
    case "typography.ellipsis":
    case "typography.whitespace": {
      const replacement = typographyReplacement(finding);
      return replacement === null
        ? []
        : [textChange(finding, replacement)].filter((change): change is Change => change !== null);
    }
    case "houseStyle.terminology":
    case "houseStyle.spellingVariant":
    case "houseStyle.capitalization.sentenceCase":
    case "houseStyle.capitalization.titleCase": {
      const replacement = houseStyleReplacement(finding);
      return replacement === null
        ? []
        : [textChange(finding, replacement)].filter((change): change is Change => change !== null);
    }
    case "houseStyle.bannedTerm": {
      const change = deleteChange(finding);
      return change === null ? [] : [change];
    }
    case "formatting.unknownStyle":
    case "formatting.emptyStyle":
    case "formatting.emptyHeading":
      return [styleChange(finding, "Normal")].filter((change): change is Change => change !== null);
    case "formatting.headingHierarchy":
      return [styleChange(finding, headingStyle(finding.message))].filter(
        (change): change is Change => change !== null,
      );
    case "formatting.directFormatting":
      return [directFormatChange(finding)];
    case "formatting.listLevel": {
      const change = listLevelChange(finding, 0);
      return change === null ? [] : [change];
    }
    default:
      return finding.kind === "semantic" ? semanticChanges(finding) : [];
  }
}

/** Convert validated findings into a conflict-aware, optionally stale plan. */
export function planChanges(options: PlanOptions): ChangePlan {
  const findings = options.findings.flatMap((rawFinding) => {
    const result = FindingSchema.safeParse(rawFinding);
    return result.success ? [result.data] : [];
  });
  const changes = findings.flatMap(changesForFinding);
  const basePlan = createChangePlan(options.docHash, options.baseDocId, changes, findings);
  const planWithConflicts = {
    ...basePlan,
    conflicts: detectConflicts(changes),
  };
  return ChangePlanSchema.parse(markStale(planWithConflicts, options.currentDocHash));
}

/** Descriptive alias for callers that prefer a factory-style name. */
export const createChangePlanFromFindings = planChanges;
