/**
 * Deterministic finding → `Change` planning.
 *
 * Spec §7 and §14.5. This is the single place a deterministic finding becomes a
 * `Change`, and it exists because there were two. The planner had one switch and
 * `src/formatting/normalizer.ts` had another; the two disagreed about the same
 * categories, and where they agreed they agreed on corrections the
 * specification forbids.
 *
 * **Style-first.** A deviation from a configured Word style is corrected by
 * applying that style, not by writing the font, size, spacing or indent the
 * style would have produced. One mutation instead of several, one place for the
 * user to inspect the result, and no new direct formatting to accumulate on top
 * of the document's own.
 *
 * **The reset gate.** `resetCharacterFormatting` is the one change that can
 * destroy the author's work rather than the profile's: it clears bold, italic
 * and underline along with the font override. Spec §14.5 permits it only where
 * the profile declares the standard style-controlled *and* acquisition proved
 * which properties were written directly — and even then it is reported rather
 * than offered, because the safe correction is the style, which the
 * style-identity finding already provides.
 *
 * Boundary rule: `core/domain` only. This module is reached from the planner and
 * from no UI, and it reads no Office object, so a change can be built and
 * asserted in a unit test with no host and no mock.
 */

import { v4 as uuidv4 } from "uuid";
import {
  ChangeSchema,
  type Change,
  type ChangeInput,
  type ChangePrecondition,
  type ChangeRange,
} from "../core/domain/Change";
import type { Finding, Range } from "../core/domain/Finding";
import {
  ELLIPSIS,
  EM_DASH,
  EN_DASH,
  RIGHT_DOUBLE_QUOTE,
  RIGHT_SINGLE_QUOTE,
} from "../shared/utils/text";
import { toTitleCase } from "../shared/utils/caseConversion";
import { approvalPolicyForFinding } from "./approvalPolicy";

/**
 * The categories that can produce a change.
 *
 * Exported so the registry audit can assert the two sides agree. A category the
 * registry calls correctable but that is missing here is a rule advertising
 * "Approve" for something Apply would silently drop; a category here that no
 * rule emits is a planner case no finding can ever reach. Both are defects the
 * user finds as either a dead button or a silent no-op.
 */
export const DETERMINISTIC_CORRECTABLE_CATEGORIES: ReadonlySet<string> = new Set([
  "typography.emDash",
  "typography.enDashSpacing",
  "typography.doubleQuotes",
  "typography.singleQuotes",
  "typography.apostrophes",
  "typography.decimalSeparator",
  "typography.thousandsSeparator",
  "typography.ellipsis",
  "typography.whitespace",
  "typography.punctuation",
  "language.terminology.preferred",
  "houseStyle.capitalization.titleCase",
  "language.capitalisation.sentenceCase",
  "language.capitalisation.properNoun",
  "language.capitalisation.prohibited",
  /*
   * `headingCase` is listed because *some* of its findings are correctable — an
   * upper-case house gets a letter to raise, a title-case house gets a letter to
   * cap. The sentence-case findings carry `correctionAvailable: false` and offer
   * no correction, so the entry records a category the planner can sometimes act
   * on rather than a claim that it always can.
   */
  "language.capitalisation.headingCase",
  "language.abbreviation.prohibited",
  "language.abbreviation.firstUse",
  "language.abbreviation.preferredExpanded",
  // No `language.number.decimalSeparator`: that check moved to the typography
  // rule (D2), which owns both separators. Keeping the case here would have been a
  // planner branch no finding can reach.
  "language.number.percentageSpacing",
  /*
   * `(5)` and `-5` are the same number written two ways, so both directions are
   * correctable — unlike a range rewritten as `5 to 10`, which changes the
   * author's register.
   */
  "language.number.negative",
  "language.number.range",
  "language.currency.spacing",
  "language.unit.spacing",
  "language.unit.capitalisation",
  "language.unit.preferredSymbol",
  "language.bannedTerm",
  "formatting.bodyStyle",
  "formatting.headingStyle",
  "formatting.styleStandard",
  "formatting.listStyle",
  "formatting.emptyStyle",
  "formatting.listLevel",
]);

/**
 * Categories a rule may report but the planner will never turn into a change.
 *
 * Listed rather than left implicit so the registry can declare them honestly:
 * each is a decision the user makes, and a change would be ToneForge making it
 * for them. A date's field order cannot be resolved without knowing which part
 * is the day; a numeral the style spells out is the author's prose; a custom
 * style is the author's own structure.
 */
export const DETERMINISTIC_REPORTED_ONLY_CATEGORIES: ReadonlySet<string> = new Set([
  "language.date.ambiguous",
  "language.date.format",
  "language.number.spelling",
  "language.currency.representation",
  /*
   * How large an amount is written. Abbreviating `4,200,000` as `4.2m` does not
   * restate the figure — it replaces it with a rounded one — and expanding `4.2m`
   * needs the tool to decide which magnitude the author meant. Either correction
   * would be ToneForge choosing the author's figure for them.
   */
  "language.currency.magnitude",
  /*
   * A heading level is not a paragraph style. Promoting or demoting one rewrites
   * the document outline, and a skipped level has several legitimate
   * resolutions - insert the missing heading, renumber the ones below it, or
   * accept the gap - none of which ToneForge can choose for the author. The
   * planner used to apply a single-paragraph style change here, computed by
   * re-parsing the finding's own message; see ADR-0116.
   */
  "formatting.headingHierarchy",
  /*
   * A required term that is absent. There is no text to rewrite, so any correction
   * would be the tool writing the author's prose; the finding says what the house
   * expects and the author decides where it belongs.
   */
  "language.terminology.missing",
  "formatting.directFormatting",
  "formatting.unknownStyle",
  "formatting.emptyHeading",
  // Declared by rules that have no body yet. Listing them here rather than in the
  // plannable set is the honest interim answer: T19 and T20 give these rules a
  // body, and a rule with no body cannot produce a finding to correct.
  "formatting.tableStyle",
  "formatting.headerFooter",
  "formatting.pageSetup",
  /*
   * Group names, not findings. `language/abbreviations` groups its findings
   * under `language.abbreviation`, `language/currency` under
   * `language.currency` and `language/units` under `language.unit`, and the
   * heading is what the review UI shows and what a profile setting is named
   * after — the specific categories beneath it are what a finding carries.
   */
  "language.abbreviation",
  "language.currency",
  "language.unit",
  "language.date",
]);

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

/**
 * The exact text a text change expects to find.
 *
 * Named `_finding` because the precondition is the text alone: a text
 * precondition is compared against a range, and a range is not identified by
 * the finding that proposed it. Paragraph-scoped changes use
 * `formattingPrecondition` below, which does carry node identity.
 */
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

/**
 * The precondition a formatting change must satisfy before it may be written.
 *
 * A paragraph-scoped edit is identified by node, not by offset: a text change
 * carries `expectedText`, and by the time a plan is applied the document may
 * have shifted. Where a finding carried one, it is used; otherwise the node is
 * derived from the paragraph index, which is the identity acquisition gave it.
 */
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

/** The spec §7 correction: apply the style, write nothing else. */
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

/**
 * The text a case finding is about.
 *
 * An anchored finding carries a `transformation` naming the exact span and the
 * case to apply, which is more precise than the 40-character evidence excerpt
 * every finding carries as a preview. Where it is absent the evidence is the
 * only text available, and the excerpt is what gets cased.
 */
function casedEvidence(finding: Finding): string {
  return finding.transformation?.kind === "case" ? finding.transformation.text : finding.evidence;
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
    /*
     * `typography.emDash` has two replacements and a message that says which is
     * wanted — the message is the rule's only statement of the direction, and the
     * finding's `expected` is not populated for a typography substitution. It once
     * had a third branch reading "plain space", which rewrote a dash to a space
     * and deleted the author's punctuation. That value is gone from the schema, so
     * the branch is gone too: an unrecognised message now plans nothing rather than
     * guessing a replacement.
     */
    case "typography.emDash":
      return /double hyphen \(--\) instead/i.test(message) ? "--" : EM_DASH;
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
    /*
     * Spacing around a solidus, a percent sign, a currency symbol, a bracket or
     * a hyphenated compound. The rule already wrote the corrected text into
     * `expected`, so it is read rather than re-derived — the same contract the
     * language categories below use, and for the same reason: re-parsing the
     * message would be a second, divergent answer to the same question.
     */
    case "typography.punctuation":
      return typeof finding.expected === "string" ? finding.expected : null;
    default:
      return null;
  }
}

function single(change: Change | null): Change[] {
  return change === null ? [] : [change];
}

/**
 * Build the corrections one deterministic finding calls for.
 *
 * Returns an empty array for a finding that is not actionable, that the user has
 * ignored or deferred, that the rule itself declined to correct, or that falls
 * outside the categories above. The rule's own decision comes first: a category
 * with a case below still produces nothing when the finding says
 * `correctionAvailable: false`, which is what keeps a reported-only finding from
 * acquiring a correction on the way to the planner.
 */
export function planDeterministicChange(finding: Finding): Change[] {
  if (finding.actionable === false) return [];
  if (finding.status === "ignored" || finding.status === "deferred") return [];
  if (finding.deterministic?.correctionAvailable === false) return [];

  switch (finding.category) {
    case "typography.emDash":
    case "typography.enDashSpacing":
    case "typography.doubleQuotes":
    case "typography.singleQuotes":
    case "typography.apostrophes":
    case "typography.decimalSeparator":
    case "typography.thousandsSeparator":
    case "typography.ellipsis":
    case "typography.whitespace":
    case "typography.punctuation": {
      const replacement = typographyReplacement(finding);
      return replacement === null ? [] : single(textChange(finding, replacement));
    }

    /*
     * Spec §4.2's language conventions.
     *
     * One case for all of them, because they share a single contract: the rule
     * already decided the replacement and wrote it into `expected`. A finding
     * whose correction is a number or a boolean rather than a string is left
     * alone — those are the categories below that carry a different answer.
     */
    case "language.capitalisation.sentenceCase":
    case "language.capitalisation.properNoun":
    case "language.capitalisation.prohibited":
    case "language.capitalisation.headingCase":
    case "language.abbreviation.prohibited":
    case "language.abbreviation.firstUse":
    case "language.abbreviation.preferredExpanded":
    case "language.number.percentageSpacing":
    case "language.number.range":
    case "language.number.negative":
    case "language.currency.spacing":
    case "language.unit.spacing":
    case "language.unit.capitalisation":
    // D4: a named unit written where the house prefers its symbol. A plain
    // `replaceText` for the same reason as the cases above — the symbol and the
    // name denote the same quantity, so the edit restates the measurement and
    // cannot change it.
    case "language.unit.preferredSymbol": {
      if (finding.deterministic?.correctionAvailable !== true) return [];
      if (typeof finding.expected !== "string") return [];
      return single(textChange(finding, finding.expected));
    }

    /*
     * A banned term has no replacement, so the correction is a deletion. The
     * empty `expected` is what distinguishes it from a substitution, so this
     * case is separate rather than folded into the one above.
     */
    case "language.bannedTerm":
      return single(deleteChange(finding));

    case "language.terminology.preferred": {
      /*
       * `expected` first, the message second.
       *
       * The rule already decided the replacement and wrote it into `expected`,
       * including the source's own capitalisation. Re-parsing the message to
       * recover it works only while the message quotes the replacement in a
       * shape `quotedReplacement` recognises — and its character class excludes
       * the apostrophe, so a house term containing one (`author's manual`)
       * produced no capture at all and the finding silently offered no
       * correction. Reading the value the rule computed is also the same
       * contract the typography and language categories above already use.
       *
       * The empty string is excluded so a genuinely empty expectation still
       * falls through to the message-based answer rather than producing a
       * deleteRange from a field that was never populated.
       */
      const replacement =
        typeof finding.expected === "string" && finding.expected.length > 0
          ? finding.expected
          : quotedReplacement(finding.message);
      return replacement === null ? [] : single(textChange(finding, replacement));
    }

    /*
     * The legacy title-case word list, and only that. Sentence case has a
     * normative rule in the `language.capitalisation` section, and giving the
     * legacy check an owner as well put two findings on the same character: the
     * planner then built two overlapping changes and refused the whole plan as
     * conflicting, which is what an integration test caught. The word list has
     * no equivalent in the expanded section, so it keeps its own owner until
     * the legacy record is retired.
     */
    case "houseStyle.capitalization.titleCase":
      return single(textChange(finding, finding.expected ?? toTitleCase(casedEvidence(finding))));

    /*
     * Spec §7, style-first.
     *
     * Every style-identity deviation is corrected by applying the Word style the
     * profile names. The property-level findings the same rules can raise
     * (`formatting.bodyStyle.paragraph.spaceAfter` and its siblings) arrive under
     * the same category, but the rule marks them uncorrectable, so the gate
     * above has already returned. That is deliberate: writing a value over a
     * paragraph is the direct formatting the style-first strategy exists to
     * avoid, and applying the style fixes the value too.
     */
    case "formatting.bodyStyle":
    case "formatting.headingStyle":
    case "formatting.styleStandard":
    case "formatting.listStyle":
    case "formatting.emptyStyle":
      return single(styleChange(finding, finding.expected ?? "Normal"));

    /*
     * `formatting.headingHierarchy` has no case here on purpose (ADR-0116).
     *
     * It used to, and it derived the style to apply by re-parsing the finding's
     * own message: `/follows\s+[”"']?Heading\s+(\d+)/` captured the level the
     * heading *followed* and added one. For a Heading 3 after a Heading 1 that
     * answers `Heading 2` — a level the message never proposed — so the
     * fallback was wrong exactly when a finding lacked `expected`. Both analyzer
     * findings do set it, which is why it never fired in production, but a
     * second answer to the same question is a latent defect: it is dead today and
     * live the moment a third caller appears.
     *
     * The category is report-only instead. Renumbering a heading rewrites the
     * document outline, and a skipped level has several legitimate resolutions.
     */
    case "formatting.headingHierarchy":
      return [];

    case "formatting.listLevel": {
      const expected = finding.deterministic?.expected;
      if (
        typeof expected !== "number" ||
        !Number.isInteger(expected) ||
        expected < 0 ||
        expected > 8
      ) {
        return [];
      }
      return single(listLevelChange(finding, expected));
    }

    default:
      return [];
  }
}
