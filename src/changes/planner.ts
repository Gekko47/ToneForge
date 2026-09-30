/**
 * Plan construction: governance, conflict detection and staleness.
 *
 * Spec §7 and §14.5 put the *decision* about what a deterministic finding
 * corrects in `src/changes/deterministicChanges.ts`, which is the single owner
 * of deterministic change planning. This module is what surrounds that decision:
 * it stamps the approval policy a governance author configured, it detects
 * changes that conflict, and it marks a plan stale when the document has moved
 * since the scan. Splitting them is what stopped the two files from disagreeing
 * about the same category — which they did, over `formatting.emptyHeading`,
 * where one applied `Normal` and the other deleted nothing.
 *
 * Pure: no Office, no LLM, no UI imports.
 */

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
import type { GovernanceRule } from "../core/domain/GovernanceProfile";
import { approvalPolicyForFinding, ruleForFinding } from "./approvalPolicy";
import { planDeterministicChange } from "./deterministicChanges";
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

function makeChange(params: {
  type: ChangeInput["type"];
  range: ChangeRange;
  payload: ChangeInput["payload"];
  rationale: string;
  finding: Finding;
  reversible?: boolean;
  precondition: ChangePrecondition;
}): Change {
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
  if (finding.kind === "semantic") return semanticChanges(finding);
  return planDeterministicChange(finding);
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
