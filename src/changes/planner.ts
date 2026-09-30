/** Pure finding-to-plan planner with immutable provenance and target contracts. */

import { v4 as uuidv4 } from "uuid";
import {
  ChangeSchema,
  type Change,
  type ChangeInput,
  type ChangePrecondition,
  type ChangeRange,
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
import { toSentenceCase, toTitleCase } from "../shared/utils/caseConversion";
import type { GovernanceRule } from "../core/domain/GovernanceProfile";
import { approvalPolicyForFinding, ruleForFinding } from "./approvalPolicy";
import { detectConflicts } from "./conflictDetector";
import { markStale } from "./staleGuard";

export interface PlanOptions {
  findings: Finding[];
  docHash: string;
  baseDocId: string;
  /**
   * The author's governance rules, bound to findings by category.
   *
   * Optional because a plan can be built without a governance profile at all,
   * and in that case the finding-derived policy is the whole answer. When
   * supplied, a rule may raise the approval requirement and may withhold a
   * change entirely via `autoFix: false`; it can never lower either.
   */
  governanceRules?: GovernanceRule[];
  currentDocHash?: string;
  documentId?: string;
  documentVersion?: string;
  structuralHash?: string;
  analysisText?: string;
  analysisStart?: number;
  analysisEnd?: number;
  analysisTruncated?: boolean;
  profileId?: string;
  profileRevision?: number;
  governancePolicyRevision?: number;
}

interface CreateChangeParams {
  type: ChangeInput["type"];
  range: ChangeRange;
  payload: ChangeInput["payload"];
  rationale: string;
  finding: Finding;
  reversible?: boolean;
  precondition: ChangePrecondition;
}

/**
 * Re-stamp the changes a finding produced with the policy that governs them.
 *
 * Applied once, after the fact, rather than threaded through every change
 * constructor: a rule changes two things about a change — whether it needs
 * approval, and whether Pending Changes explains where it came from — and both
 * are properties of the finished change rather than of the code that made it.
 * Doing it here also means a new change type cannot forget to consult policy.
 */
function applyRule(finding: Finding, changes: Change[], rule: GovernanceRule): Change[] {
  const approval = approvalPolicyForFinding(finding, rule);
  return changes.map((change) =>
    ChangeSchema.parse({
      ...change,
      approvalRequired: approval.approvalRequired,
      approvalState: approval.approvalState,
      // The policy is named, not just applied. A governance author who set a
      // rule needs to see it cited, or the rule is an invisible setting again.
      rationale: `${change.rationale} (policy: ${rule.description})`,
    }),
  );
}

function toChangeRange(range: Range): ChangeRange {
  if (range.unit === "paragraph") {
    return {
      start: range.start,
      end: range.end,
      unit: "paragraph",
      target: { kind: "paragraph", index: range.start },
    };
  }
  if (range.unit === "section") {
    return {
      start: range.start,
      end: range.end,
      unit: "section",
      target: { kind: "section", index: range.start },
    };
  }
  return { start: range.start, end: range.end };
}

function makeChange(params: CreateChangeParams): Change {
  const approval = approvalPolicyForFinding(params.finding);
  return ChangeSchema.parse({
    id: uuidv4(),
    type: params.type,
    range: params.range,
    payload: params.payload,
    rationale: params.rationale,
    reversible: params.reversible ?? true,
    source: params.finding.source,
    risk: params.finding.risk,
    approvalRequired: approval.approvalRequired,
    approvalState: approval.approvalState,
    findingId: params.finding.id,
    ...(params.finding.ruleId ? { ruleId: params.finding.ruleId } : {}),
    precondition: params.precondition,
    dependsOn: [],
    ...(params.finding.suggestedChangeId === undefined
      ? {}
      : { suggestedChangeId: params.finding.suggestedChangeId }),
  });
}

function textPrecondition(_finding: Finding, expected: string): ChangePrecondition {
  return { kind: "text", expectedText: expected };
}

function textChange(finding: Finding, text: string): Change | null {
  const expected = finding.actual ?? finding.evidence;
  if (text.length === 0) {
    if (finding.range.start === finding.range.end) return null;
    return makeChange({
      type: "deleteRange",
      range: toChangeRange(finding.range),
      payload: {},
      rationale: finding.message,
      finding,
      reversible: true,
      precondition: textPrecondition(finding, expected),
    });
  }
  const type = finding.range.start === finding.range.end ? "insertText" : "replaceText";
  return makeChange({
    type,
    range: toChangeRange(finding.range),
    payload: { text },
    rationale: finding.message,
    finding,
    precondition: textPrecondition(finding, expected),
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
    precondition: textPrecondition(finding, finding.actual ?? finding.evidence),
  });
}

function formattingPrecondition(finding: Finding): ChangePrecondition | null {
  if (finding.precondition !== undefined) return finding.precondition;
  if (finding.nodeIds[0] !== undefined) {
    return {
      kind: "node",
      nodeId: finding.nodeIds[0],
      ...(finding.actual === undefined ? {} : { expectedText: finding.actual }),
    };
  }
  if (finding.kind === "formatting" || finding.category.startsWith("formatting.")) {
    return {
      kind: "node",
      nodeId: `formatting-paragraph-${finding.range.start}`,
      ...(finding.actual === undefined ? {} : { expectedText: finding.actual }),
    };
  }
  return null;
}

function styleChange(finding: Finding, styleName: string): Change | null {
  const trimmed = styleName.trim();
  const precondition = formattingPrecondition(finding);
  if (trimmed.length === 0 || precondition === null) return null;
  return makeChange({
    type: "applyStyle",
    range: toChangeRange(finding.range),
    payload: { styleName: trimmed },
    rationale: finding.message,
    finding,
    precondition,
  });
}

function listLevelChange(finding: Finding, level: number): Change | null {
  const precondition = formattingPrecondition(finding);
  if (!Number.isInteger(level) || level < 0 || precondition === null) return null;
  return makeChange({
    type: "setListLevel",
    range: toChangeRange(finding.range),
    payload: { level },
    rationale: finding.message,
    finding,
    precondition,
  });
}

function directFormatChange(finding: Finding): Change | null {
  const precondition = formattingPrecondition(finding);
  if (precondition === null) return null;
  return makeChange({
    type: "resetCharacterFormatting",
    range: toChangeRange(finding.range),
    payload: {},
    rationale: finding.message,
    finding,
    precondition,
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
    case "typography.decimalSeparator":
      return /dot \(\.\)/i.test(message) ? "." : ",";
    case "typography.thousandsSeparator":
      if (/remove/i.test(message)) return "";
      return /comma/i.test(message) ? "," : " ";
    case "typography.ellipsis":
      if (/use three dots/i.test(message)) return "...";
      if (/spaced dots/i.test(message)) return ". . .";
      if (/ellipsis character/i.test(message)) return ELLIPSIS;
      return ELLIPSIS;
    case "typography.whitespace":
      return /trailing space/i.test(message) ? "" : " ";
    default:
      return null;
  }
}

function houseStyleReplacement(finding: Finding): string | null {
  switch (finding.category) {
    case "houseStyle.terminology":
      return quotedReplacement(finding.message);
    case "houseStyle.spellingVariant": {
      const match = /\bspelling\s+[“"']([^”"']+)[”"']\s+instead\s+of/i.exec(finding.message);
      return match?.[1]?.trim() ?? quotedReplacement(finding.message);
    }
    case "houseStyle.capitalization.sentenceCase":
      return finding.transformation?.kind === "case" && finding.transformation.style === "sentence"
        ? toSentenceCase(finding.transformation.text)
        : toSentenceCase(finding.evidence);
    case "houseStyle.capitalization.titleCase":
      if (finding.expected !== undefined) return finding.expected;
      return finding.transformation?.kind === "case" && finding.transformation.style === "title"
        ? toTitleCase(finding.transformation.text)
        : toTitleCase(finding.evidence);
    default:
      return null;
  }
}

/**
 * Turn a semantic finding into a change.
 *
 * `expected` is preferred over parsing the message, and the reason is that an
 * anchored semantic finding has already had its suggestion verified against a
 * real document offset. Re-deriving the replacement from prose would discard
 * that verification and reintroduce the guessing the anchor removed — and it
 * would fail on any suggestion that is not phrased as `Use "x" instead of "y"`.
 *
 * The prose parser remains for unanchored findings, which is the only case it
 * still has to serve.
 */
function semanticChanges(finding: Finding): Change[] {
  const replacement =
    finding.expected !== undefined && finding.expected.length > 0
      ? finding.expected
      : quotedReplacement(finding.message);
  if (replacement === null) return [];
  if (finding.evidence.length === 0 && finding.range.start !== finding.range.end) return [];
  const change = textChange(finding, replacement);
  return change === null ? [] : [change];
}

function changesForFinding(finding: Finding): Change[] {
  if (finding.actionable === false) return [];
  if (finding.status === "ignored" || finding.status === "deferred") return [];
  switch (finding.category) {
    case "typography.emDash":
    case "typography.emDashSpacing":
    case "typography.enDashSpacing":
    case "typography.doubleQuotes":
    case "typography.singleQuotes":
    case "typography.apostrophes":
    case "typography.decimalSeparator":
    case "typography.thousandsSeparator":
    case "typography.ellipsis":
    case "typography.whitespace": {
      const replacement = typographyReplacement(finding);
      const change = replacement === null ? null : textChange(finding, replacement);
      return change === null ? [] : [change];
    }
    /*
     * Spec §4.2's language conventions.
     *
     * One case for all of them, because they share a single contract: the rule
     * already decided the replacement and wrote it into `expected`, and
     * `deterministic.correctionAvailable` says whether there is one. A finding
     * without a correction produces no change, which is what keeps the review
     * from offering an "Approve" for something Apply cannot do — a date the
     * scanner will not reorder, a numeral it will not spell out, a figure it
     * will not round.
     */
    case "language.capitalisation.sentenceCase":
    case "language.capitalisation.properNoun":
    case "language.capitalisation.prohibited":
    case "language.abbreviation.prohibited":
    case "language.abbreviation.firstUse":
    case "language.number.decimalSeparator":
    case "language.number.percentageSpacing":
    case "language.number.range":
    case "language.currency.spacing":
    case "language.unit.spacing":
    case "language.unit.capitalisation": {
      if (finding.deterministic?.correctionAvailable !== true) return [];
      if (typeof finding.expected !== "string") return [];
      const change = textChange(finding, finding.expected);
      return change === null ? [] : [change];
    }
    /*
     * A banned term has no replacement, so the correction is a deletion. The
     * empty `expected` is what distinguishes it from a substitution, so this
     * case is separate rather than folded into the one above.
     */
    case "language.bannedTerm": {
      const change = deleteChange(finding);
      return change === null ? [] : [change];
    }
    /*
     * Reported without a correction, and deliberately planned as nothing. A
     * date's field order, a numeral the style spells out, a range rewritten as
     * words, a currency code with no symbol to substitute: each is a claim the
     * user resolves, and the planner is the last place that could quietly turn
     * one into an edit.
     */
    case "language.date.ambiguous":
    case "language.date.format":
    case "language.number.spelling":
    case "language.currency.representation":
    case "language.unit.magnitude":
      return [];
    case "houseStyle.terminology":
    case "houseStyle.spellingVariant":
    case "houseStyle.capitalization.sentenceCase":
    case "houseStyle.capitalization.titleCase": {
      const replacement =
        finding.category === "houseStyle.capitalization.titleCase" && finding.expected !== undefined
          ? finding.expected
          : houseStyleReplacement(finding);
      const change = replacement === null ? null : textChange(finding, replacement);
      return change === null ? [] : [change];
    }
    case "houseStyle.bannedTerm": {
      const change = deleteChange(finding);
      return change === null ? [] : [change];
    }
    case "formatting.unknownStyle":
    case "formatting.emptyStyle":
    case "formatting.emptyHeading": {
      const change = styleChange(finding, "Normal");
      return change === null ? [] : [change];
    }
    case "formatting.headingHierarchy": {
      const targetStyle = finding.expected ?? headingStyle(finding.message);
      const change = styleChange(finding, targetStyle);
      return change === null ? [] : [change];
    }
    case "formatting.directFormatting": {
      const change = directFormatChange(finding);
      return change === null ? [] : [change];
    }
    case "formatting.listLevel": {
      const change = listLevelChange(finding, 0);
      return change === null ? [] : [change];
    }
    default:
      // `consistency` is deliberately absent. A consistency finding reports that
      // two statements disagree; it does not yet carry a corrected sentence, and
      // its `actual`/`expected` pair is the engine quoting the two sides of the
      // conflict rather than a before-and-after of one piece of text. Replacing
      // one with the other at the finding's range is an edit nobody specified.
      // Consistency findings stay in the report until the engine supplies a real
      // correction and the bridge supplies a range that lands on it.
      return finding.kind === "semantic" ? semanticChanges(finding) : [];
  }
}

function headingStyle(message: string): string {
  const previous = /follows\s+[”"']?Heading\s+(\d+)/i.exec(message);
  if (previous?.[1] !== undefined) {
    const previousLevel = Number.parseInt(previous[1], 10);
    if (Number.isInteger(previousLevel) && previousLevel >= 1 && previousLevel < 9) {
      return `Heading ${previousLevel + 1}`;
    }
  }
  const match = /Heading\s*(\d+)/i.exec(message);
  return match?.[1] !== undefined ? `Heading ${match[1]}` : "Heading 1";
}

export function planChanges(options: PlanOptions): ChangePlan {
  const findings = options.findings.flatMap((raw) => {
    const result = FindingSchema.safeParse(raw);
    return result.success ? [result.data] : [];
  });
  const changes = findings.flatMap((finding) => {
    const rule = ruleForFinding(finding, options.governanceRules);
    // `autoFix: false` is the author's decision that a category is reported but
    // not corrected. The finding still appears in the plan's report and in the
    // Findings list; it simply produces no change, so Apply has nothing to write
    // for it. A rule with no `autoFix` field at all defaults to false, so a rule
    // that exists is reporting-only until someone opts it into correction.
    if (rule !== null && !rule.autoFix) return [];
    const produced = changesForFinding(finding);
    return rule === null ? produced : applyRule(finding, produced, rule);
  });
  const basePlan = createChangePlan(options.docHash, options.baseDocId, changes, findings, {
    schemaVersion: 2,
    ...(options.governancePolicyRevision === undefined
      ? {}
      : { governancePolicyRevision: options.governancePolicyRevision }),
    documentId: options.documentId ?? options.baseDocId,
    contentHash: options.docHash,
    validation: {
      protectionChecked: true,
      identityChecked: true,
      rangeChecked: true,
      preconditionsChecked: true,
      approvalsChecked: true,
    },
    ...(options.documentVersion === undefined ? {} : { documentVersion: options.documentVersion }),
    ...(options.structuralHash === undefined ? {} : { structuralHash: options.structuralHash }),
    ...(options.analysisText === undefined ? {} : { analysisText: options.analysisText }),
    ...(options.analysisStart === undefined ? {} : { analysisStart: options.analysisStart }),
    ...(options.analysisEnd === undefined ? {} : { analysisEnd: options.analysisEnd }),
    ...(options.analysisTruncated === undefined
      ? {}
      : { analysisTruncated: options.analysisTruncated }),
    ...(options.profileId === undefined ? {} : { profileId: options.profileId }),
    ...(options.profileRevision === undefined ? {} : { profileRevision: options.profileRevision }),
  });
  return ChangePlanSchema.parse(
    markStale({ ...basePlan, conflicts: detectConflicts(changes) }, options.currentDocHash),
  );
}

export const createChangePlanFromFindings = planChanges;
