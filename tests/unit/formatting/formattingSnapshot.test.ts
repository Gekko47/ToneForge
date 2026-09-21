import { describe, expect, it } from "vitest";
import {
  FormattingParagraphSchema,
  FormattingSnapshotSchema,
  ParagraphAlignmentSchema,
} from "../../../src/formatting/formattingSnapshot";
import * as formattingIndex from "../../../src/formatting";

describe("FormattingSnapshotSchema", () => {
  it("parses a complete snapshot", () => {
    const snapshot = FormattingSnapshotSchema.parse({
      id: "snapshot-1",
      text: "Hello world.",
      paragraphs: [
        {
          index: 0,
          text: "Hello world.",
          styleName: "Heading 1",
          alignment: "left",
          lineSpacing: 1.2,
          spaceAfter: 10,
          spaceBefore: 0,
          listLevel: 0,
          fontName: "Calibri",
          fontSize: 12,
          fontColor: "#000000",
          bold: true,
          italic: false,
          underline: true,
        },
      ],
      capturedAt: "2026-01-01T00:00:00.000Z",
      hash: "abc123",
    });

    expect(snapshot.paragraphs[0]?.fontName).toBe("Calibri");
  });

  it("applies defaults for missing optional paragraph fields", () => {
    const paragraph = FormattingParagraphSchema.parse({
      index: 0,
      text: "Body",
    });

    expect(paragraph).toMatchObject({
      styleName: "Normal",
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
    });
  });

  it("rejects invalid paragraph values", () => {
    expect(() =>
      FormattingParagraphSchema.parse({
        index: -1,
        text: "Body",
        styleName: "Normal",
        alignment: "invalid",
      }),
    ).toThrow();
  });

  it("parses a snapshot without a hash", () => {
    const snapshot = FormattingSnapshotSchema.parse({
      id: "snapshot-1",
      text: "Body",
      paragraphs: [],
      capturedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(snapshot.hash).toBeUndefined();
  });

  it("rejects snapshots with empty ids", () => {
    expect(() =>
      FormattingSnapshotSchema.parse({
        id: "",
        text: "Body",
        paragraphs: [],
        capturedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("ParagraphAlignmentSchema", () => {
  it("parses supported alignments", () => {
    expect(ParagraphAlignmentSchema.parse("left")).toBe("left");
    expect(ParagraphAlignmentSchema.parse("center")).toBe("center");
    expect(ParagraphAlignmentSchema.parse("right")).toBe("right");
    expect(ParagraphAlignmentSchema.parse("justified")).toBe("justified");
    expect(ParagraphAlignmentSchema.parse(null)).toBeNull();
  });

  it("rejects unsupported alignments", () => {
    expect(() => ParagraphAlignmentSchema.parse("middle")).toThrow();
  });
});

describe("formatting barrel exports", () => {
  it("re-exports the formatting engine contracts", () => {
    expect(formattingIndex.FormattingSnapshotSchema).toBe(FormattingSnapshotSchema);
    expect(formattingIndex.FormattingParagraphSchema).toBe(FormattingParagraphSchema);
    expect(formattingIndex.ParagraphAlignmentSchema).toBe(ParagraphAlignmentSchema);
    expect(formattingIndex.findFormattingIssues).toBeDefined();
    expect(formattingIndex.normalizeFormatting).toBeDefined();
    expect(formattingIndex.lookupWordStyle).toBeDefined();
    expect(formattingIndex.WORD_STYLE_MAPPING).toBeDefined();
    expect(formattingIndex.HEADING_STYLE_NAMES).toBeDefined();
  });
});
