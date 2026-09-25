/** Pure, support-aware Word formatting analyzer. */

import { v4 as uuidv4 } from "uuid";
import type { Finding, Range, Severity } from "../core/domain/Finding";
import type { FormattingSnapshot, FormattingParagraph } from "./formattingSnapshot";
import { lookupWordStyle, HEADING_STYLE_NAMES } from "./wordStyles";

export interface FormattingCheckOptions {
  snapshot: FormattingSnapshot;
}

export function findFormattingIssues(options: FormattingCheckOptions): Finding[] {
  const { snapshot } = options;
  if (snapshot.paragraphs.length === 0) return [];
  return [
    ...checkHeadingHierarchy(snapshot),
    ...checkUnknownStyles(snapshot),
    ...checkDirectFormatting(snapshot),
    ...checkListLevel(snapshot),
    ...checkEmptyHeadings(snapshot),
  ];
}

function makeFinding(params: {
  category: string;
  range: Range;
  message: string;
  severity: Severity;
  evidence: string;
  paragraph?: FormattingParagraph;
  actual?: string | undefined;
  expected?: string | undefined;
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
    ...(params.actual === undefined ? {} : { actual: params.actual }),
    ...(params.expected === undefined ? {} : { expected: params.expected }),
    ...(precondition === undefined ? {} : { precondition }),
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

const HEADING_RE = /^heading\s*([1-9])$/i;
const isHeading = (name: string): boolean => HEADING_RE.test(name.trim());
const headingLevel = (name: string): number =>
  Number.parseInt(HEADING_RE.exec(name.trim())?.[1] ?? "0", 10);

function checkHeadingHierarchy(snapshot: FormattingSnapshot): Finding[] {
  const findings: Finding[] = [];
  let previousLevel = 0;
  snapshot.paragraphs.forEach((paragraph) => {
    const styleName = paragraph.styleName ?? "Normal";
    if (!isHeading(styleName)) return;
    const level = headingLevel(styleName);
    if (previousLevel > 0 && level > previousLevel + 1) {
      findings.push(
        makeFinding({
          category: "formatting.headingHierarchy",
          range: paragraphRange(paragraph),
          message: `Heading level skipped: "${styleName}" follows "Heading ${previousLevel}" without an intermediate level`,
          severity: "warning",
          evidence: paragraph.text.slice(0, 40),
          paragraph,
          actual: paragraph.styleName,
          expected: `Heading ${previousLevel + 1}`,
        }),
      );
    }
    previousLevel = level;
  });
  return findings;
}

function checkUnknownStyles(snapshot: FormattingSnapshot): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  snapshot.paragraphs.forEach((paragraph) => {
    const styleName = (paragraph.styleName ?? "").trim();
    if (styleName.length === 0) {
      findings.push(
        makeFinding({
          category: "formatting.emptyStyle",
          range: paragraphRange(paragraph),
          message: "Paragraph has no applied Word style; default to Normal",
          severity: "info",
          evidence: paragraph.text.slice(0, 40),
          paragraph,
          expected: "Normal",
        }),
      );
      return;
    }
    if (lookupWordStyle(styleName) !== undefined || seen.has(styleName.toLowerCase())) return;
    seen.add(styleName.toLowerCase());
    findings.push(
      makeFinding({
        category: "formatting.unknownStyle",
        range: paragraphRange(paragraph),
        message: `Unknown Word style "${styleName}" is not in the recognized style table`,
        severity: "info",
        evidence: styleName,
        paragraph,
        expected: "Normal",
      }),
    );
  });
  return findings;
}

function checkDirectFormatting(snapshot: FormattingSnapshot): Finding[] {
  if (snapshot.coverage?.directFormattingProvenance === "unsupported") return [];
  return snapshot.paragraphs.flatMap((paragraph) => {
    const hasProvenance = paragraph.provenance !== undefined;
    const hasDirect = hasProvenance
      ? Object.values(paragraph.provenance ?? {}).includes("direct")
      : paragraph.fontName !== null ||
        paragraph.fontSize !== null ||
        paragraph.fontColor !== null ||
        paragraph.bold === true ||
        paragraph.italic === true ||
        paragraph.underline === true;
    if (!hasDirect) return [];
    return [
      makeFinding({
        category: "formatting.directFormatting",
        range: paragraphRange(paragraph),
        message:
          "Paragraph has direct character formatting; clear it so the applied Word style controls appearance",
        severity: "warning",
        evidence: paragraph.text.slice(0, 40),
        paragraph,
      }),
    ];
  });
}

function checkListLevel(snapshot: FormattingSnapshot): Finding[] {
  const listStyles = new Set(["list paragraph", "list bullet", "list number"]);
  return snapshot.paragraphs.flatMap((paragraph) => {
    if (
      paragraph.listLevel === null ||
      paragraph.listLevel === 0 ||
      listStyles.has((paragraph.styleName ?? "").trim().toLowerCase())
    ) {
      return [];
    }
    return [
      makeFinding({
        category: "formatting.listLevel",
        range: paragraphRange(paragraph),
        message: `Paragraph has list level ${paragraph.listLevel} but style "${paragraph.styleName}" is not a list style`,
        severity: "warning",
        evidence: paragraph.text.slice(0, 40),
        paragraph,
        expected: "List level 0",
      }),
    ];
  });
}

function checkEmptyHeadings(snapshot: FormattingSnapshot): Finding[] {
  const headingOrTitle = new Set([
    "title",
    "subtitle",
    ...HEADING_STYLE_NAMES.map((name) => name.toLowerCase()),
  ]);
  return snapshot.paragraphs.flatMap((paragraph) => {
    if (
      !headingOrTitle.has((paragraph.styleName ?? "").trim().toLowerCase()) ||
      paragraph.text.trim().length > 0
    ) {
      return [];
    }
    return [
      makeFinding({
        category: "formatting.emptyHeading",
        range: paragraphRange(paragraph),
        message: `Empty "${paragraph.styleName}" paragraph — remove or add content`,
        severity: "info",
        evidence: paragraph.styleName ?? "",
        paragraph,
        expected: "Normal",
      }),
    ];
  });
}
