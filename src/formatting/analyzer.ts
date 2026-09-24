/**
 * Deterministic formatting analyzer.
 *
 * Scans a `FormattingSnapshot` against the active `StyleProfile` and reports
 * formatting deviations as `Finding` objects with paragraph ranges. Pure:
 * no Office, no LLM, no UI imports — fully unit-testable without Word.
 *
 * Boundary rule: this module may only import from `core/domain` and
 * `shared/utils` (see docs/architecture.md and ADR-0006).
 */

import { v4 as uuidv4 } from "uuid";
import type { Finding, Range, Severity } from "../core/domain/Finding";
import type { FormattingSnapshot, FormattingParagraph } from "./formattingSnapshot";
import { lookupWordStyle, HEADING_STYLE_NAMES } from "./wordStyles";

export interface FormattingCheckOptions {
  snapshot: FormattingSnapshot;
}

/** Scan a formatting snapshot for structural formatting deviations. */
export function findFormattingIssues(options: FormattingCheckOptions): Finding[] {
  const { snapshot } = options;
  if (snapshot.paragraphs.length === 0) return [];

  const findings: Finding[] = [];
  findings.push(...checkHeadingHierarchy(snapshot));
  findings.push(...checkUnknownStyles(snapshot));
  findings.push(...checkDirectFormatting(snapshot));
  findings.push(...checkListLevel(snapshot));
  findings.push(...checkEmptyHeadings(snapshot));
  return findings;
}

function makeFinding(params: {
  category: string;
  range: Range;
  message: string;
  severity: Severity;
  evidence: string;
  suggestedChangeId?: string;
}): Finding {
  return {
    id: uuidv4(),
    kind: "formatting",
    category: params.category,
    range: params.range,
    message: params.message,
    severity: params.severity,
    evidence: params.evidence,
    confidence: 1,
    nodeIds: [],
    source: "deterministic",
    risk: "none",
    reversible: true,
    status: "new",
    ...(params.suggestedChangeId ? { suggestedChangeId: params.suggestedChangeId } : {}),
  };
}

function paragraphRange(para: FormattingParagraph): Range {
  return { start: para.index, end: para.index + 1, unit: "paragraph" };
}

const HEADING_RE = /^heading\s+(\d+)$/i;

function isHeading(name: string): boolean {
  return HEADING_RE.test(name.trim());
}

function headingLevel(name: string): number {
  const match = HEADING_RE.exec(name.trim());
  const level = match?.[1];
  return level !== undefined ? Number.parseInt(level, 10) : 0;
}

/** Heading levels must not skip (e.g. Heading 1 → Heading 3). */
function checkHeadingHierarchy(snapshot: FormattingSnapshot): Finding[] {
  const findings: Finding[] = [];
  let previousLevel = 0;

  snapshot.paragraphs.forEach((para) => {
    if (!isHeading(para.styleName)) return;
    const level = headingLevel(para.styleName);
    if (previousLevel > 0 && level > previousLevel + 1) {
      findings.push(
        makeFinding({
          category: "formatting.headingHierarchy",
          range: paragraphRange(para),
          message: `Heading level skipped: "${para.styleName}" follows "Heading ${previousLevel}" without an intermediate level`,
          severity: "warning",
          evidence: para.text.slice(0, 40),
        }),
      );
    }
    previousLevel = level;
  });

  return findings;
}

/** Unknown Word style names are reported as informational findings. */
function checkUnknownStyles(snapshot: FormattingSnapshot): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  snapshot.paragraphs.forEach((para) => {
    const styleName = para.styleName.trim();
    if (styleName.length === 0) {
      findings.push(
        makeFinding({
          category: "formatting.emptyStyle",
          range: paragraphRange(para),
          message: "Paragraph has no applied Word style; default to Normal",
          severity: "info",
          evidence: para.text.slice(0, 40),
        }),
      );
      return;
    }
    if (lookupWordStyle(styleName) !== undefined) return;
    if (seen.has(styleName.toLowerCase())) return;
    seen.add(styleName.toLowerCase());
    findings.push(
      makeFinding({
        category: "formatting.unknownStyle",
        range: paragraphRange(para),
        message: `Unknown Word style "${styleName}" is not in the recognized style table`,
        severity: "info",
        evidence: styleName,
      }),
    );
  });

  return findings;
}

/** Manual character formatting that should be cleared in favor of the Word style. */
function checkDirectFormatting(snapshot: FormattingSnapshot): Finding[] {
  const findings: Finding[] = [];

  snapshot.paragraphs.forEach((para) => {
    if (
      para.fontName === null &&
      para.fontSize === null &&
      para.fontColor === null &&
      para.bold !== true &&
      para.italic !== true &&
      para.underline !== true
    ) {
      return;
    }

    findings.push(
      makeFinding({
        category: "formatting.directFormatting",
        range: paragraphRange(para),
        message:
          "Paragraph has direct character formatting; clear it so the applied Word style controls appearance",
        severity: "warning",
        evidence: para.text.slice(0, 40),
      }),
    );
  });

  return findings;
}

/** A list level without an applied list style is suspicious. */
function checkListLevel(snapshot: FormattingSnapshot): Finding[] {
  const findings: Finding[] = [];
  const listStyleNames = new Set(["list paragraph", "list bullet", "list number"]);

  snapshot.paragraphs.forEach((para) => {
    if (para.listLevel === null || para.listLevel === 0) return;
    if (listStyleNames.has(para.styleName.trim().toLowerCase())) return;
    findings.push(
      makeFinding({
        category: "formatting.listLevel",
        range: paragraphRange(para),
        message: `Paragraph has list level ${para.listLevel} but style "${para.styleName}" is not a list style`,
        severity: "warning",
        evidence: para.text.slice(0, 40),
      }),
    );
  });

  return findings;
}

/** Empty heading or title paragraphs are usually accidental. */
function checkEmptyHeadings(snapshot: FormattingSnapshot): Finding[] {
  const findings: Finding[] = [];
  const headingOrTitle = new Set([
    "title",
    "subtitle",
    ...HEADING_STYLE_NAMES.map((name) => name.toLowerCase()),
  ]);

  snapshot.paragraphs.forEach((para) => {
    if (!headingOrTitle.has(para.styleName.trim().toLowerCase())) return;
    if (para.text.trim().length > 0) return;
    findings.push(
      makeFinding({
        category: "formatting.emptyHeading",
        range: paragraphRange(para),
        message: `Empty "${para.styleName}" paragraph — remove or add content`,
        severity: "info",
        evidence: para.styleName,
      }),
    );
  });

  return findings;
}
