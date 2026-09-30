/**
 * Profile-driven Word formatting checks.
 *
 * Spec §10 replaces the heuristics this module used to run. The earlier version
 * asked "does this paragraph look consistent with the document it is in?" — it
 * flagged any direct character formatting, any non-`Normal` body paragraph, and
 * any style name missing from a hard-coded table. None of those questions has an
 * answer that does not depend on which style the *user* chose, so the module
 * reported deviations from a standard nobody had written down.
 *
 * The rule now is one sentence: a paragraph deviates when it differs from the
 * standard the active profile names, and only when the host actually served the
 * property being compared. Universal integrity checks (a skipped heading level,
 * an empty heading) are retained, but they are gated on the `structure` section
 * rather than running unconditionally, and they are reported as integrity rather
 * than as profile non-compliance.
 *
 * **Why the capabilities are a parameter.** A property the host would not serve
 * reads as `null`, and `null` here means "not read", not "zero". Comparing a
 * configured `leftIndent` of 0 against an unread property would invent a
 * deviation in a document ToneForge never inspected, which is exactly the false
 * compliance claim spec §9 and §27 gate 12 exist to prevent. So every comparison
 * that needs a property first checks that the property was read.
 */

import { v4 as uuidv4 } from "uuid";
import type { Finding, Range, Severity } from "../core/domain/Finding";
import type {
  CharacterStandard,
  DocumentFormattingProfile,
  DocumentStructureProfile,
  ParagraphStandard,
  ParagraphStyleStandard,
} from "../core/domain/StyleProfile";
import type { FormattingSnapshot, FormattingParagraph } from "./formattingSnapshot";
import { lookupWordStyle, HEADING_STYLE_NAMES } from "./wordStyles";

/**
 * The host capabilities the formatting comparisons depend on.
 *
 * Declared structurally rather than imported from `AnalysisCapabilities` so this
 * module keeps its place in the deterministic boundary: the formatting engine
 * needs three booleans, and importing the analysis context to get them would
 * make the data flow point the wrong way.
 */
export interface FormattingCapabilities {
  /** Whether the host serves a paragraph's Word style name. */
  supportsStyles: boolean;
  /** Whether the host serves paragraph and character formatting values. */
  supportsParagraphFormat: boolean;
  /** Whether the host serves a list item's level. */
  supportsListLevel: boolean;
}

export interface FormattingCheckOptions {
  snapshot: FormattingSnapshot;
  /**
   * The document standard to compare against.
   *
   * Required, not defaulted to a built-in standard: a check with no profile has
   * nothing to compare against, and defaulting would restore the very heuristic
   * this module exists to remove while appearing profile-driven.
   */
  profile: DocumentFormattingProfile;
  /** Document-shape rules, which gate the universal integrity checks. */
  structure: DocumentStructureProfile;
  capabilities: FormattingCapabilities;
}

export function findFormattingIssues(options: FormattingCheckOptions): Finding[] {
  const { snapshot, profile, structure, capabilities } = options;
  if (snapshot.paragraphs.length === 0) return [];
  return [
    ...checkEmptyStyle(snapshot, profile),
    ...checkBodyStyle(snapshot, profile, capabilities),
    ...checkNamedStyles(snapshot, profile, capabilities),
    ...checkHeadingStyle(snapshot, profile, capabilities),
    ...checkDirectFormatting(snapshot, profile),
    ...checkListFormatting(snapshot, profile, capabilities),
    ...checkHeadingHierarchy(snapshot, structure),
    ...checkUnknownStyles(snapshot, structure, capabilities),
    ...checkEmptyHeadings(snapshot, structure),
  ];
}

/** The Word styles that mean something other than body text. */
const HEADING_RE = /^heading\s*([1-9])$/i;
const TITLE_STYLES = new Set(["title", "subtitle", "caption"]);
const LIST_STYLES = new Set(["list paragraph", "list bullet", "list number", "list continue"]);

function isHeadingStyle(name: string): boolean {
  return HEADING_RE.test(name.trim());
}

function headingLevelOf(name: string): number {
  return Number.parseInt(HEADING_RE.exec(name.trim())?.[1] ?? "0", 10);
}

/** Whether a style name is one of the built-in list styles, case-insensitively. */
function isListStyle(name: string): boolean {
  return LIST_STYLES.has(name.trim().toLowerCase());
}

/**
 * The style standard a paragraph is expected to carry, and where in the profile
 * that expectation is written.
 *
 * A paragraph qualifies for the body standard only when it is not a heading, a
 * title, a subtitle, a caption, or a list item. Without those exclusions the body
 * rule would report every heading in the document as a body-style deviation, and
 * two rules would own one finding.
 */
function expectedStandard(
  paragraph: FormattingParagraph,
  profile: DocumentFormattingProfile,
): { standard: ParagraphStyleStandard; path: string } | null {
  const styleName = (paragraph.styleName ?? "").trim();
  if (isHeadingStyle(styleName)) {
    const level = headingLevelOf(styleName);
    const standard = profile.headings[String(level) as HeadingLevelKey];
    return standard ? { standard, path: `formatting.headings.${level}` } : null;
  }
  /*
   * A named non-body style is compared against its own standard or not at all.
   *
   * Falling through to the body standard would be the heuristic §10 removes: it
   * asserts that a `Title` paragraph should be `Normal`, which is a claim about
   * the document's structure that the profile has not made. A profile that says
   * nothing about titles has not decided a title is wrong — it has not looked.
   */
  const lower = styleName.toLowerCase();
  if (lower === "title") {
    return profile.titleStyle
      ? { standard: profile.titleStyle, path: "formatting.titleStyle" }
      : null;
  }
  if (lower === "subtitle") {
    return profile.subtitleStyle
      ? { standard: profile.subtitleStyle, path: "formatting.subtitleStyle" }
      : null;
  }
  if (lower === "caption") {
    return profile.captions ? { standard: profile.captions, path: "formatting.captions" } : null;
  }
  if (isListStyle(styleName) || typeof paragraph.listLevel === "number") return null;
  return { standard: profile.bodyStyle, path: "formatting.bodyStyle" };
}

type HeadingLevelKey = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

/** One property that differs from the standard. */
interface Deviation {
  property: string;
  expected: unknown;
  actual: unknown;
}

/**
 * Compare a configured standard against what the host read for one paragraph.
 *
 * A property whose value is `null` is skipped, not treated as zero. That single
 * rule is what keeps a degraded acquisition from reporting a clean paragraph as
 * a non-compliant one, and it is why the same function serves both the
 * style-identity comparison and the direct-formatting gate.
 */
function deviationsFor(
  paragraph: FormattingParagraph,
  standard: ParagraphStyleStandard,
): Deviation[] {
  return [
    ...characterDeviations(paragraph, standard.font),
    ...paragraphDeviations(paragraph, standard.paragraph),
  ];
}

function characterDeviations(
  paragraph: FormattingParagraph,
  font: CharacterStandard | undefined,
): Deviation[] {
  if (!font) return [];
  return (
    [
      ["font.name", font.name, paragraph.fontName],
      ["font.size", font.size, paragraph.fontSize],
      ["font.color", font.color, paragraph.fontColor],
      ["font.bold", font.bold, paragraph.bold],
      ["font.italic", font.italic, paragraph.italic],
      ["font.underline", font.underline, paragraph.underline],
    ] as const
  ).flatMap(([property, expected, actual]) =>
    expected === undefined || actual === null || actual === expected
      ? []
      : [{ property, expected, actual }],
  );
}

function paragraphDeviations(
  paragraph: FormattingParagraph,
  standard: ParagraphStandard | undefined,
): Deviation[] {
  if (!standard) return [];
  return (
    [
      ["paragraph.alignment", standard.alignment, paragraph.alignment],
      ["paragraph.lineSpacing", standard.lineSpacing, paragraph.lineSpacing],
      ["paragraph.spaceBefore", standard.spaceBefore, paragraph.spaceBefore],
      ["paragraph.spaceAfter", standard.spaceAfter, paragraph.spaceAfter],
      ["paragraph.leftIndent", standard.leftIndent, paragraph.leftIndent],
      ["paragraph.rightIndent", standard.rightIndent, paragraph.rightIndent],
      ["paragraph.firstLineIndent", standard.firstLineIndent, paragraph.firstLineIndent],
      ["paragraph.keepWithNext", standard.keepWithNext, paragraph.keepNext],
      ["paragraph.keepLinesTogether", standard.keepLinesTogether, paragraph.keepLines],
      ["paragraph.pageBreakBefore", standard.pageBreakBefore, paragraph.pageBreakBefore],
    ] as const
  ).flatMap(([property, expected, actual]) =>
    expected === undefined || actual === null || actual === expected
      ? []
      : [{ property, expected, actual }],
  );
}

function makeFinding(params: {
  category: string;
  range: Range;
  message: string;
  severity: Severity;
  evidence: string;
  paragraph?: FormattingParagraph;
  profilePath: string;
  /** The value the profile wants, carried through the finding metadata. */
  expectedValue?: unknown;
  /** The value the host read, carried through the finding metadata. */
  actualValue?: unknown;
  /**
   * The expected value as the finding's top-level `expected` string.
   *
   * `Finding.expected` is a string, and the planner reads it to build a
   * correction. The metadata keeps the typed value, so a list level of `0` is a
   * number in `deterministic.expected` and the string `"0"` in `expected` —
   * which is what both the planner and the UI want from each.
   */
  expected?: string;
  /** Whether the planner can build a safe correction for this finding. */
  correctable?: boolean;
  correctionReason?: string;
  /** The deviations of one standard that belong in one group. */
  occurrenceGroupKey?: string;
  /** Set only where approving several occurrences at once is provably safe. */
  safeBatchKey?: string;
}): Finding {
  const precondition = params.paragraph ? paragraphPrecondition(params.paragraph) : undefined;
  return {
    id: uuidv4(),
    kind: "formatting",
    category: params.category,
    range: params.range,
    message: params.message,
    severity: params.severity,
    evidence: params.evidence,
    confidence: 1,
    ruleId: params.category,
    nodeIds: params.paragraph?.nodeId ? [params.paragraph.nodeId] : [],
    source: "deterministic",
    risk: "none",
    reversible: true,
    status: "new",
    ...(params.expected === undefined ? {} : { expected: params.expected }),
    ...(precondition === undefined ? {} : { precondition }),
    deterministic: {
      profilePath: params.profilePath,
      ...(params.expectedValue === undefined ? {} : { expected: params.expectedValue }),
      ...(params.actualValue === undefined ? {} : { actual: params.actualValue }),
      // The fallback keys on the profile path, which is unique per property, so
      // a finding that declares neither still lands in a group of its own rather
      // than joining every other paragraph deviation.
      ...(params.occurrenceGroupKey === undefined
        ? { occurrenceGroupKey: params.profilePath }
        : { occurrenceGroupKey: params.occurrenceGroupKey }),
      ...(params.safeBatchKey === undefined ? {} : { safeBatchKey: params.safeBatchKey }),
      correctionAvailable: params.correctable ?? true,
      ...(params.correctionReason === undefined
        ? {}
        : { correctionReason: params.correctionReason }),
    },
  };
}

function paragraphPrecondition(
  paragraph: FormattingParagraph,
): NonNullable<Finding["precondition"]> {
  const nodeId = paragraph.nodeId ?? `formatting-paragraph-${paragraph.index}`;
  return {
    kind: "node",
    nodeId,
    expectedText: paragraph.text,
    expectedStyleName: paragraph.styleName,
    expectedFormatting: {
      styleName: paragraph.styleName,
      alignment: paragraph.alignment,
      listLevel: paragraph.listLevel,
      fontName: paragraph.fontName,
      fontSize: paragraph.fontSize,
      fontColor: paragraph.fontColor,
      bold: paragraph.bold,
      italic: paragraph.italic,
      underline: paragraph.underline,
    },
  };
}

function paragraphRange(paragraph: FormattingParagraph): Range {
  return { start: paragraph.index, end: paragraph.index + 1, unit: "paragraph" };
}

/** A style-identity deviation, reported against the standard that wanted it. */
function styleFindings(params: {
  paragraph: FormattingParagraph;
  standard: ParagraphStyleStandard;
  path: string;
  category: string;
}): Finding[] {
  const { paragraph, standard, path, category } = params;
  const styleName = (paragraph.styleName ?? "").trim();
  const findings: Finding[] = [];
  if (styleName.toLowerCase() !== standard.styleName.toLowerCase()) {
    findings.push(
      makeFinding({
        category,
        range: paragraphRange(paragraph),
        message: `Paragraph carries "${styleName}" but the profile expects "${standard.styleName}"`,
        severity: "warning",
        evidence: paragraph.text.slice(0, 40),
        paragraph,
        profilePath: `${path}.styleName`,
        expected: standard.styleName,
        expectedValue: standard.styleName,
        actualValue: styleName,
        // Grouped by the standard it wants, not by the category: four body
        // paragraphs wanting "Normal" are one decision, and a mis-styled
        // subtitle wanting "Subtitle" is a different one. Batch-safe because
        // `applyStyle` of a named Word style to N paragraphs is the same edit
        // N times, and applying a style cannot destroy author emphasis.
        occurrenceGroupKey: `${path}.styleName|${standard.styleName}`,
        safeBatchKey: `style:${path}|${standard.styleName}`,
      }),
    );
  }
  deviationsFor(paragraph, standard).forEach((deviation) => {
    findings.push(
      makeFinding({
        category,
        range: paragraphRange(paragraph),
        message: `${deviation.property} is ${String(deviation.actual)} but the profile expects ${String(deviation.expected)}`,
        severity: "warning",
        evidence: paragraph.text.slice(0, 40),
        paragraph,
        profilePath: `${path}.${deviation.property}`,
        expected: String(deviation.expected),
        expectedValue: deviation.expected,
        actualValue: deviation.actual,
        /*
         * Grouped by property and expected value, and never batch-safe.
         *
         * Grouping by property alone would put "alignment is left" next to
         * "alignment is justified" and the group would then refuse for the wrong
         * reason. Batch approval is refused outright because the correction is
         * not available at all — the two lines below say why — and a group whose
         * members have no correction to approve together should not offer a
         * control that approves nothing.
         */
        occurrenceGroupKey: `${path}.${deviation.property}|${String(deviation.expected)}`,
        // A property deviation is reported, not auto-corrected: writing a font
        // size or an indent over a paragraph is exactly the direct formatting
        // the profile's style-first strategy exists to avoid. Spec §7 prefers
        // `applyStyle` for the same reason, so correcting the style alone is the
        // safe move and a property-only correction is offered by neither rule.
        correctable: false,
        correctionReason:
          "A property override is corrected by applying the configured Word style, not by writing the value directly.",
      }),
    );
  });
  return findings;
}

/**
 * A paragraph with no applied style.
 *
 * Acquisition answers `Normal` for a paragraph whose style it did not load, so
 * an empty name means the host reported none at all. The finding is informational
 * and separate from the body-style deviation that follows from it, because the
 * two need different corrections and grouping them would offer the user one
 * approval for two decisions.
 */
function checkEmptyStyle(
  snapshot: FormattingSnapshot,
  profile: DocumentFormattingProfile,
): Finding[] {
  return snapshot.paragraphs.flatMap((paragraph) => {
    if ((paragraph.styleName ?? "").trim().length > 0) return [];
    return [
      makeFinding({
        category: "formatting.emptyStyle",
        range: paragraphRange(paragraph),
        message: `Paragraph has no applied Word style; the profile expects "${profile.bodyStyle.styleName}"`,
        severity: "info",
        evidence: paragraph.text.slice(0, 40),
        paragraph,
        profilePath: "formatting.bodyStyle.styleName",
        expected: profile.bodyStyle.styleName,
        expectedValue: profile.bodyStyle.styleName,
        actualValue: "",
      }),
    ];
  });
}

function checkBodyStyle(
  snapshot: FormattingSnapshot,
  profile: DocumentFormattingProfile,
  capabilities: FormattingCapabilities,
): Finding[] {
  if (!capabilities.supportsStyles) return [];
  return snapshot.paragraphs.flatMap((paragraph) => {
    if ((paragraph.styleName ?? "").trim().length === 0) return [];
    const expected = expectedStandard(paragraph, profile);
    if (expected === null || expected.path !== "formatting.bodyStyle") return [];
    return styleFindings({
      paragraph,
      standard: expected.standard,
      path: expected.path,
      category: "formatting.bodyStyle",
    });
  });
}

/**
 * Title, subtitle and caption standards.
 *
 * A separate category from the body comparison because the two are not the same
 * claim: a body deviation says "this is the wrong kind of paragraph", a named
 * style deviation says "this is the right kind of paragraph set the wrong way".
 * Grouping them together would put a mis-styled subtitle in the same batch as a
 * body paragraph, and approving the batch would apply the body's correction to
 * the subtitle.
 */
function checkNamedStyles(
  snapshot: FormattingSnapshot,
  profile: DocumentFormattingProfile,
  capabilities: FormattingCapabilities,
): Finding[] {
  if (!capabilities.supportsStyles) return [];
  return snapshot.paragraphs.flatMap((paragraph) => {
    const expected = expectedStandard(paragraph, profile);
    if (expected === null) return [];
    if (
      expected.path !== "formatting.titleStyle" &&
      expected.path !== "formatting.subtitleStyle" &&
      expected.path !== "formatting.captions"
    ) {
      return [];
    }
    return styleFindings({
      paragraph,
      standard: expected.standard,
      path: expected.path,
      category: "formatting.styleStandard",
    });
  });
}

function checkHeadingStyle(
  snapshot: FormattingSnapshot,
  profile: DocumentFormattingProfile,
  capabilities: FormattingCapabilities,
): Finding[] {
  if (!capabilities.supportsStyles) return [];
  return snapshot.paragraphs.flatMap((paragraph) => {
    const styleName = (paragraph.styleName ?? "").trim();
    if (!isHeadingStyle(styleName)) return [];
    const expected = expectedStandard(paragraph, profile);
    // No configured standard for this level is not a deviation. Spec §10.2 asks
    // for skipped levels to be reported separately from visual non-compliance,
    // and inventing an expectation for an unconfigured level would be exactly
    // the heuristic this module replaced.
    if (expected === null) return [];
    return styleFindings({
      paragraph,
      standard: expected.standard,
      path: expected.path,
      category: "formatting.headingStyle",
    });
  });
}

/**
 * Direct formatting, gated on the profile saying the style owns the property.
 *
 * Spec §10.3. The previous version flagged every direct character format in the
 * document, which meant a bold run in a sentence was a finding. Bold, italic and
 * underline are therefore never reported: they are the author's emphasis, and
 * clearing them would erase intent. Only the three font properties are, and only
 * where the standard's `styleControlledFormatting` is set *and* acquisition proved
 * the value was written directly rather than inherited.
 *
 * Without provenance there is no finding at all. `directFormattingProvenance:
 * "unsupported"` is a coverage limitation (spec §20), and reporting a guess in its
 * place would convert an honest gap into a confident wrong answer.
 */
function checkDirectFormatting(
  snapshot: FormattingSnapshot,
  profile: DocumentFormattingProfile,
): Finding[] {
  if (snapshot.coverage?.directFormattingProvenance === "unsupported") return [];
  return snapshot.paragraphs.flatMap((paragraph) => {
    const expected = expectedStandard(paragraph, profile);
    if (expected === null || !expected.standard.styleControlledFormatting) return [];
    const provenance = paragraph.provenance;
    const overridden = (["fontName", "fontSize", "fontColor"] as const).filter(
      (property) => provenance?.[property] === "direct",
    );
    if (overridden.length === 0) return [];
    return [
      makeFinding({
        category: "formatting.directFormatting",
        range: paragraphRange(paragraph),
        message: `${overridden.join(", ")} overridden directly on a paragraph whose profile standard is style-controlled; apply "${expected.standard.styleName}" instead`,
        severity: "warning",
        evidence: paragraph.text.slice(0, 40),
        paragraph,
        profilePath: `${expected.path}.styleControlledFormatting`,
        expected: expected.standard.styleName,
        expectedValue: expected.standard.styleName,
        actualValue: (paragraph.styleName ?? "").trim(),
        // Not correctable by a reset: `font.reset()` would also strip the
        // bold and italic runs this rule deliberately leaves alone, so the safe
        // correction is the style, which T13 attaches to the style-identity
        // finding instead.
        correctable: false,
        correctionReason:
          "Clearing direct formatting would also remove the author's emphasis. Apply the configured Word style instead.",
      }),
    ];
  });
}

/**
 * List presentation.
 *
 * Two separate claims, so two categories. `formatting.listStyle` is a profile
 * comparison — the profile names a list style and the paragraph does not carry
 * it. `formatting.listLevel` is a document-integrity check retained from the
 * previous version: a paragraph indented three levels deep while carrying a
 * non-list style is anomalous whichever profile is active, and a profile that
 * configures `lists.level` states the same expectation explicitly.
 */
function checkListFormatting(
  snapshot: FormattingSnapshot,
  profile: DocumentFormattingProfile,
  capabilities: FormattingCapabilities,
): Finding[] {
  const lists = profile.lists;
  return snapshot.paragraphs.flatMap((paragraph) => {
    const styleName = (paragraph.styleName ?? "").trim();
    const listLike = isListStyle(styleName) || typeof paragraph.listLevel === "number";
    const findings: Finding[] = [];

    if (lists?.styleName !== undefined && listLike) {
      if (styleName.toLowerCase() !== lists.styleName.toLowerCase()) {
        findings.push(
          makeFinding({
            category: "formatting.listStyle",
            range: paragraphRange(paragraph),
            message: `List paragraph carries "${styleName}" but the profile expects "${lists.styleName}"`,
            severity: "warning",
            evidence: paragraph.text.slice(0, 40),
            paragraph,
            profilePath: "formatting.lists.styleName",
            expected: lists.styleName,
            expectedValue: lists.styleName,
            actualValue: styleName,
          }),
        );
      }
    }

    const level = paragraph.listLevel;
    if (typeof level !== "number") return findings;

    if (!isListStyle(styleName) && level > 0) {
      findings.push(
        makeFinding({
          category: "formatting.listLevel",
          range: paragraphRange(paragraph),
          message: `Paragraph has list level ${level} but style "${styleName}" is not a list style`,
          severity: "warning",
          evidence: paragraph.text.slice(0, 40),
          paragraph,
          profilePath: "structure.listLevelIntegrity",
          expected: "List level 0",
          expectedValue: 0,
          actualValue: level,
        }),
      );
      return findings;
    }

    if (
      capabilities.supportsListLevel &&
      lists?.supported === true &&
      lists.level !== undefined &&
      level !== lists.level
    ) {
      findings.push(
        makeFinding({
          category: "formatting.listLevel",
          range: paragraphRange(paragraph),
          message: `List paragraph is at level ${level} but the profile expects level ${lists.level}`,
          severity: "warning",
          evidence: paragraph.text.slice(0, 40),
          paragraph,
          profilePath: "formatting.lists.level",
          expected: `List level ${lists.level}`,
          expectedValue: lists.level,
          actualValue: level,
        }),
      );
    }
    return findings;
  });
}

/**
 * Skipped and over-deep heading levels.
 *
 * Universal integrity, but it reads two profile fields. `allowSkippedHeadingLevels`
 * is a real editorial policy — a short report may legitimately jump from H2 to
 * H4 — and `maxHeadingLevel` is the depth the document is allowed to reach. A
 * rule that fired on both regardless would contradict a profile that had
 * explicitly answered them.
 */
function checkHeadingHierarchy(
  snapshot: FormattingSnapshot,
  structure: DocumentStructureProfile,
): Finding[] {
  const findings: Finding[] = [];
  let previousLevel = 0;
  snapshot.paragraphs.forEach((paragraph) => {
    const styleName = (paragraph.styleName ?? "Normal").trim();
    if (!isHeadingStyle(styleName)) return;
    const level = headingLevelOf(styleName);

    if (structure.maxHeadingLevel !== undefined && level > structure.maxHeadingLevel) {
      findings.push(
        makeFinding({
          category: "formatting.headingHierarchy",
          range: paragraphRange(paragraph),
          message: `"${styleName}" is deeper than the profile's maximum heading level ${structure.maxHeadingLevel}`,
          severity: "warning",
          evidence: paragraph.text.slice(0, 40),
          paragraph,
          profilePath: "structure.maxHeadingLevel",
          expected: `Heading ${structure.maxHeadingLevel}`,
          expectedValue: structure.maxHeadingLevel,
          actualValue: level,
        }),
      );
    }

    if (
      previousLevel > 0 &&
      level > previousLevel + 1 &&
      structure.allowSkippedHeadingLevels !== true
    ) {
      findings.push(
        makeFinding({
          category: "formatting.headingHierarchy",
          range: paragraphRange(paragraph),
          message: `Heading level skipped: "${styleName}" follows "Heading ${previousLevel}" without an intermediate level`,
          severity: "warning",
          evidence: paragraph.text.slice(0, 40),
          paragraph,
          profilePath: "structure.allowSkippedHeadingLevels",
          expected: `Heading ${previousLevel + 1}`,
          expectedValue: `Heading ${previousLevel + 1}`,
          actualValue: styleName,
        }),
      );
    }
    previousLevel = level;
  });
  return findings;
}

/**
 * A style name outside the recognised Word table.
 *
 * Gated on `reportUnknownStyles` and on the host serving style names: the check
 * compares the name against a table, so a host that did not read the name would
 * produce the same finding for every paragraph in the document.
 */
function checkUnknownStyles(
  snapshot: FormattingSnapshot,
  structure: DocumentStructureProfile,
  capabilities: FormattingCapabilities,
): Finding[] {
  if (!structure.reportUnknownStyles || !capabilities.supportsStyles) return [];
  const findings: Finding[] = [];
  const seen = new Set<string>();
  snapshot.paragraphs.forEach((paragraph) => {
    const styleName = (paragraph.styleName ?? "").trim();
    if (styleName.length === 0) return;
    if (lookupWordStyle(styleName) !== undefined || TITLE_STYLES.has(styleName.toLowerCase())) {
      return;
    }
    if (seen.has(styleName.toLowerCase())) return;
    seen.add(styleName.toLowerCase());
    findings.push(
      makeFinding({
        category: "formatting.unknownStyle",
        range: paragraphRange(paragraph),
        message: `Unknown Word style "${styleName}" is not in the recognized style table`,
        severity: "info",
        evidence: styleName,
        paragraph,
        profilePath: "structure.reportUnknownStyles",
        expectedValue: "a recognised Word style",
        actualValue: styleName,
        // A custom style is not a defect; the report says the name is one
        // ToneForge has no table entry for. Renaming it would destroy the
        // author's own structure.
        correctable: false,
        correctionReason:
          "A custom style is not a defect, and replacing it with a built-in would discard the author's own document structure.",
      }),
    );
  });
  return findings;
}

/** An empty heading, title or subtitle paragraph. */
function checkEmptyHeadings(
  snapshot: FormattingSnapshot,
  structure: DocumentStructureProfile,
): Finding[] {
  if (!structure.reportEmptyHeadings) return [];
  const headingOrTitle = new Set([
    ...TITLE_STYLES,
    ...HEADING_STYLE_NAMES.map((name) => name.toLowerCase()),
  ]);
  return snapshot.paragraphs.flatMap((paragraph) => {
    const styleName = (paragraph.styleName ?? "").trim();
    if (!headingOrTitle.has(styleName.toLowerCase()) || paragraph.text.trim().length > 0) {
      return [];
    }
    return [
      makeFinding({
        category: "formatting.emptyHeading",
        range: paragraphRange(paragraph),
        message: `Empty "${styleName}" paragraph — remove it or add content`,
        severity: "info",
        evidence: styleName,
        paragraph,
        profilePath: "structure.reportEmptyHeadings",
        // Removing a paragraph is a structural edit rather than a formatting
        // one, and the user may have staged the heading deliberately. The
        // finding is reported; the decision is the user's.
        correctable: false,
        correctionReason:
          "Removing a paragraph is a structural edit. Review it and delete it in Word if it is unwanted.",
      }),
    ];
  });
}
