import { describe, expect, it } from "vitest";
import { findFormattingIssues } from "../../../src/formatting/analyzer";
import type { FormattingSnapshot } from "../../../src/formatting/formattingSnapshot";

function snapshot(paragraphs: FormattingSnapshot["paragraphs"]): FormattingSnapshot {
  return {
    id: "snapshot-1",
    text: paragraphs.map((p) => p.text).join("\n\n"),
    paragraphs,
    capturedAt: "2026-01-01T00:00:00.000Z",
    hash: "abc123",
  };
}

function paragraph(
  index: number,
  text: string,
  styleName = "Normal",
): FormattingSnapshot["paragraphs"][number] {
  return {
    index,
    text,
    styleName,
    alignment: null,
    lineSpacing: null,
    spaceAfter: null,
    spaceBefore: null,
    listLevel: null,
    fontName: null,
    fontSize: null,
    fontColor: null,
    bold: null,
    italic: null,
    underline: null,
  };
}

describe("findFormattingIssues", () => {
  it("returns an empty array for empty input", () => {
    expect(findFormattingIssues({ snapshot: snapshot([]) })).toEqual([]);
  });

  it("returns no findings for a clean Normal paragraph", () => {
    const findings = findFormattingIssues({
      snapshot: snapshot([paragraph(0, "A clean paragraph.")]),
    });
    expect(findings).toEqual([]);
  });

  it("flags a skipped heading hierarchy", () => {
    const findings = findFormattingIssues({
      snapshot: snapshot([paragraph(0, "Intro", "Heading 1"), paragraph(1, "Detail", "Heading 3")]),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "formatting",
      category: "formatting.headingHierarchy",
      severity: "warning",
      confidence: 1,
    });
    expect(findings[0]!.message).toContain("Heading 3");
  });

  it("flags unknown styles as informational findings", () => {
    const findings = findFormattingIssues({
      snapshot: snapshot([
        paragraph(0, "Body", "Custom Style"),
        paragraph(1, "Again", "Custom Style"),
      ]),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "formatting",
      category: "formatting.unknownStyle",
      severity: "info",
      evidence: "Custom Style",
    });
  });

  it("flags empty style names as informational findings", () => {
    const findings = findFormattingIssues({
      snapshot: snapshot([paragraph(0, "Body", "")]),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "formatting",
      category: "formatting.emptyStyle",
      severity: "info",
    });
  });

  it("flags direct formatting overrides", () => {
    const findings = findFormattingIssues({
      snapshot: snapshot([
        {
          ...paragraph(0, "Styled text"),
          bold: true,
          italic: true,
          fontName: "Arial",
          fontSize: 12,
          fontColor: "#FF0000",
        },
      ]),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "formatting",
      category: "formatting.directFormatting",
      severity: "warning",
    });
    expect(findings[0]!.message).toContain("clear it");
  });

  it("flags list level without a list style", () => {
    const findings = findFormattingIssues({
      snapshot: snapshot([
        {
          ...paragraph(0, "List item"),
          listLevel: 1,
        },
      ]),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "formatting",
      category: "formatting.listLevel",
      severity: "warning",
    });
  });

  it("does not flag list level on a list style", () => {
    const findings = findFormattingIssues({
      snapshot: snapshot([
        {
          ...paragraph(0, "List item"),
          styleName: "List Bullet",
          listLevel: 1,
        },
      ]),
    });
    expect(findings).toEqual([]);
  });

  it("flags empty heading or title paragraphs", () => {
    const findings = findFormattingIssues({
      snapshot: snapshot([paragraph(0, "", "Title"), paragraph(1, "", "Heading 2")]),
    });
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.category)).toEqual([
      "formatting.emptyHeading",
      "formatting.emptyHeading",
    ]);
  });

  it("uses paragraph ranges and formatting kind", () => {
    const findings = findFormattingIssues({
      snapshot: snapshot([paragraph(4, "Body", "Unknown")]),
    });
    expect(findings[0]!.range).toEqual({ start: 4, end: 5, unit: "paragraph" });
    expect(findings[0]!.kind).toBe("formatting");
  });
});
