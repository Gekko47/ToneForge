import { describe, expect, it } from "vitest";
import { normalizeFormatting } from "../../../src/formatting/normalizer";
import type { Finding } from "../../../src/core/domain/Finding";
import type { FormattingSnapshot } from "../../../src/formatting/formattingSnapshot";

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

function snapshot(paragraphs: FormattingSnapshot["paragraphs"]): FormattingSnapshot {
  return {
    id: "snapshot-1",
    text: paragraphs.map((p) => p.text).join("\n\n"),
    paragraphs,
    capturedAt: "2026-01-01T00:00:00.000Z",
    hash: "abc123",
  };
}

function finding(category: string, range: Finding["range"]): Finding {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    kind: "formatting",
    category,
    range,
    message: `finding for ${category}`,
    severity: "warning",
    evidence: "evidence",
    confidence: 1,
    status: "new",
    nodeIds: [],
    source: "deterministic",
    risk: "none",
    reversible: true,
  };
}

function firstChange(changes: ReturnType<typeof normalizeFormatting>) {
  expect(changes).toHaveLength(1);
  const change = changes[0];
  expect(change).toBeDefined();
  return change as NonNullable<typeof change>;
}

describe("normalizeFormatting", () => {
  it("returns an empty array for empty findings", () => {
    const changes = normalizeFormatting({
      snapshot: snapshot([paragraph(0, "Body")]),
      findings: [],
    });
    expect(changes).toEqual([]);
  });

  it("maps unknown style findings to applyStyle changes", () => {
    const findings = [finding("formatting.unknownStyle", { start: 0, end: 1, unit: "paragraph" })];
    const changes = normalizeFormatting({
      snapshot: snapshot([paragraph(0, "Body", "Custom")]),
      findings,
    });
    const change = firstChange(changes);
    expect(change).toMatchObject({ type: "applyStyle", reversible: true });
    expect(change.payload).toEqual({ styleName: "Normal" });
  });

  it("maps empty style findings to applyStyle changes", () => {
    const findings = [finding("formatting.emptyStyle", { start: 0, end: 1, unit: "paragraph" })];
    const changes = normalizeFormatting({
      snapshot: snapshot([paragraph(0, "Body", "")]),
      findings,
    });
    const change = firstChange(changes);
    expect(change.payload).toEqual({ styleName: "Normal" });
  });

  it("maps direct formatting findings to setCharacterFormat changes", () => {
    const findings = [
      finding("formatting.directFormatting", { start: 0, end: 1, unit: "paragraph" }),
    ];
    const changes = normalizeFormatting({
      snapshot: snapshot([
        {
          ...paragraph(0, "Styled"),
          bold: true,
          fontName: "Arial",
          fontSize: 12,
          fontColor: "#000",
        },
      ]),
      findings,
    });
    const change = firstChange(changes);
    expect(change).toMatchObject({ type: "setCharacterFormat" });
    expect(change.payload).toMatchObject({ bold: true, name: "Arial", size: 12, color: "#000" });
  });

  it("omits unavailable character-format fields when normalizing direct formatting", () => {
    const findings = [
      finding("formatting.directFormatting", { start: 0, end: 1, unit: "paragraph" }),
    ];
    const changes = normalizeFormatting({
      snapshot: snapshot([{ ...paragraph(0, "Plain"), italic: false }]),
      findings,
    });
    const change = firstChange(changes);
    expect(change.payload).toEqual({
      name: undefined,
      size: undefined,
      color: undefined,
      bold: undefined,
      italic: false,
      underline: undefined,
    });
  });

  it("maps list level findings to setListLevel changes", () => {
    const findings = [finding("formatting.listLevel", { start: 0, end: 1, unit: "paragraph" })];
    const changes = normalizeFormatting({
      snapshot: snapshot([{ ...paragraph(0, "List item"), listLevel: 2 }]),
      findings,
    });
    const change = firstChange(changes);
    expect(change).toMatchObject({ type: "setListLevel" });
    expect(change.payload).toEqual({ level: 0 });
  });

  it("maps empty heading findings to applyStyle Normal", () => {
    const findings = [finding("formatting.emptyHeading", { start: 0, end: 1, unit: "paragraph" })];
    const changes = normalizeFormatting({
      snapshot: snapshot([paragraph(0, "", "Title")]),
      findings,
    });
    const change = firstChange(changes);
    expect(change).toMatchObject({ type: "applyStyle" });
    expect(change.payload).toEqual({ styleName: "Normal" });
  });

  it("maps heading hierarchy findings to applyStyle with next heading level", () => {
    const findings = [
      finding("formatting.headingHierarchy", { start: 1, end: 2, unit: "paragraph" }),
    ];
    const changes = normalizeFormatting({
      snapshot: snapshot([paragraph(0, "Intro", "Heading 1"), paragraph(1, "Detail", "Heading 3")]),
      findings,
    });
    const change = firstChange(changes);
    expect(change).toMatchObject({ type: "applyStyle" });
    expect(change.payload).toEqual({ styleName: "Heading 2" });
  });

  it("ignores findings outside the snapshot range", () => {
    const findings = [
      finding("formatting.unknownStyle", { start: 99, end: 100, unit: "paragraph" }),
    ];
    const changes = normalizeFormatting({ snapshot: snapshot([paragraph(0, "Body")]), findings });
    expect(changes).toEqual([]);
  });
});
