/**
 * The formatting DTOs' defaults, and what each one has to mean.
 *
 * These are the callbacks Zod runs when a field is absent, and they are the
 * difference between "the host did not read this" and "the property is zero".
 * Every default below is chosen so that a snapshot built from a partial host
 * response cannot be mistaken for a snapshot of a document that genuinely has
 * those values — which is the false-compliance claim §9 and §20 exist to prevent,
 * reproduced in the DTO layer rather than in the analyzer.
 *
 * The module sits at 16% function coverage with these callbacks as its whole
 * uncovered surface, so the file is as much about the defaults as about the
 * module.
 */

import { describe, expect, it } from "vitest";

import {
  FormattingParagraphSchema,
  FormattingSnapshotSchema,
  HeaderFooterSnapshotSchema,
  SectionSnapshotSchema,
  TableSnapshotSchema,
} from "../../../src/formatting/formattingSnapshot";

describe("formatting snapshot defaults", () => {
  describe("a paragraph", () => {
    it("reads every unreadable property as null rather than zero", () => {
      /*
       * The load-bearing default. A `0` here would be a *value*: the analyzer
       * compares the paragraph against the profile's standard and would report a
       * deviation on a document whose indent was never read. `null` makes it skip
       * the comparison, which is the only honest answer.
       */
      const paragraph = FormattingParagraphSchema.parse({ index: 0, text: "Body." });
      expect(paragraph.alignment).toBeNull();
      expect(paragraph.lineSpacing).toBeNull();
      expect(paragraph.spaceAfter).toBeNull();
      expect(paragraph.spaceBefore).toBeNull();
      expect(paragraph.listLevel).toBeNull();
      expect(paragraph.leftIndent).toBeNull();
      expect(paragraph.rightIndent).toBeNull();
      expect(paragraph.firstLineIndent).toBeNull();
      expect(paragraph.keepNext).toBeNull();
      expect(paragraph.keepLines).toBeNull();
      expect(paragraph.pageBreakBefore).toBeNull();
      expect(paragraph.fontName).toBeNull();
      expect(paragraph.fontSize).toBeNull();
      expect(paragraph.fontColor).toBeNull();
      expect(paragraph.bold).toBeNull();
      expect(paragraph.italic).toBeNull();
      expect(paragraph.underline).toBeNull();
    });

    it("names the style `Normal` when the host never reported one", () => {
      /*
       * `Normal`, not `""`. Word applies `Normal` to a paragraph with no applied
       * style, so this is the style it has; an empty string would produce an
       * `formatting.emptyStyle` finding on every paragraph of every document
       * scanned on a host that would not serve style names.
       */
      expect(FormattingParagraphSchema.parse({ index: 0, text: "Body." }).styleName).toBe("Normal");
    });

    it("keeps an explicit zero, because zero is a value", () => {
      // The complement of the case above: Word reports a real zero indent and a
      // real zero spacing, and coercing either to null would tell the analyzer
      // the property was not read.
      const paragraph = FormattingParagraphSchema.parse({
        index: 0,
        text: "Body.",
        spaceAfter: 0,
        leftIndent: 0,
        firstLineIndent: 0,
      });
      expect(paragraph.spaceAfter).toBe(0);
      expect(paragraph.leftIndent).toBe(0);
      expect(paragraph.firstLineIndent).toBe(0);
    });

    it("rejects a value the host could not have produced", () => {
      // A negative spacing or a list level outside 0-8 is not "unread", it is a
      // malformed read, and accepting it would put a value into a comparison the
      // analyzer trusts.
      expect(() =>
        FormattingParagraphSchema.parse({ index: 0, text: "B", spaceAfter: -1 }),
      ).toThrow();
      expect(() =>
        FormattingParagraphSchema.parse({ index: 0, text: "B", listLevel: 9 }),
      ).toThrow();
      expect(() => FormattingParagraphSchema.parse({ index: -1, text: "B" })).toThrow();
    });

    /*
     * Provenance and styleFormatting are absent, not defaulted.
     *
     * The schema *does* give every member a default of `"unknown"` — so a caller
     * that supplies a partial provenance gets the rest filled in rather than
     * `undefined`. What the field itself must not have is a default, because
     * `undefined` and "a comparison ran and found nothing" are different claims
     * and only the first is safe: the analyzer reads
     * `paragraph.provenance?.[property]`, so an absent field skips the
     * direct-formatting check entirely, while a defaulted all-`unknown` object
     * would look like a comparison that ran.
     */
    it("leaves provenance absent rather than defaulting it to unknown", () => {
      const paragraph = FormattingParagraphSchema.parse({ index: 0, text: "B" });
      expect(paragraph.provenance).toBeUndefined();
      expect(paragraph.styleFormatting).toBeUndefined();
      expect(paragraph.unsupportedProperties).toBeUndefined();
    });

    it("fills a partial provenance with unknown rather than undefined", () => {
      const paragraph = FormattingParagraphSchema.parse({
        index: 0,
        text: "B",
        provenance: { fontSize: "direct" },
      });
      expect(paragraph.provenance?.fontSize).toBe("direct");
      expect(paragraph.provenance?.fontName).toBe("unknown");
      expect(paragraph.provenance?.alignment).toBe("unknown");
    });
  });

  describe("a table (spec §8.3)", () => {
    it("reads every unreadable table property as null", () => {
      const table = TableSnapshotSchema.parse({ index: 0 });
      expect(table.styleName).toBeNull();
      expect(table.headerRow).toBeNull();
      expect(table.headerRowCount).toBeNull();
      expect(table.cellStyleName).toBeNull();
      expect(table.rowCount).toBeNull();
      expect(table.columnCount).toBeNull();
      expect(table.text).toBe("");
    });

    it("rejects a row or column count no document can have", () => {
      // A bound is what makes the count meaningful: an unchecked number would let
      // a malformed read become a "this table has 4000 rows" finding.
      expect(() => TableSnapshotSchema.parse({ index: 0, rowCount: 5000 })).toThrow();
      expect(() => TableSnapshotSchema.parse({ index: 0, columnCount: 200 })).toThrow();
      expect(() => TableSnapshotSchema.parse({ index: 0, headerRowCount: 40 })).toThrow();
    });
  });

  describe("a section (spec §8.5)", () => {
    it("reads every unreadable page property as null", () => {
      /*
       * Word on the web, exactly: `Section.pageSetup` is WordApiDesktop 1.3 and
       * does not exist there. Every geometry field reads as null, and the page
       * check skips rather than comparing the profile's margin against an absent
       * one.
       */
      const section = SectionSnapshotSchema.parse({ index: 0 });
      expect(section.orientation).toBeNull();
      expect(section.width).toBeNull();
      expect(section.height).toBeNull();
      expect(section.text).toBe("");
      // `margins` itself is optional and therefore absent when not supplied; the
      // individual edges default to null when it is. Both shapes read as "not
      // read", and the page check reads them through `section.margins?.[edge]`, so
      // either one skips rather than compares.
      expect(section.margins).toBeUndefined();
    });

    it("keeps a real zero margin", () => {
      // A zero margin is a document with no margin. Coerced to null it would read
      // as "not read", and the page check would skip a genuine deviation.
      const section = SectionSnapshotSchema.parse({
        index: 0,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      expect(section.margins?.top).toBe(0);
    });

    it("rejects a page dimension of zero or a negative one", () => {
      expect(() => SectionSnapshotSchema.parse({ index: 0, width: 0 })).toThrow();
      expect(() => SectionSnapshotSchema.parse({ index: 0, height: -1 })).toThrow();
    });

    it("rejects an orientation Word does not produce", () => {
      // The DTO is the narrowest point: `normalizeOrientation` maps an unknown
      // spelling to null, and a free string here would undo that.
      expect(() => SectionSnapshotSchema.parse({ index: 0, orientation: "sideways" })).toThrow();
      expect(SectionSnapshotSchema.parse({ index: 0, orientation: "landscape" }).orientation).toBe(
        "landscape",
      );
    });
  });

  describe("a header or footer (spec §8.4)", () => {
    it("defaults the kind to header and the requirement to false", () => {
      /*
       * `required: false`, the load-bearing one. Word serves a blank body for a
       * header the document does not have, so a blank is the evidence of
       * *absence* — a default of `true` would make every absent header look
       * present and hide the finding.
       */
      const header = HeaderFooterSnapshotSchema.parse({ index: 0 });
      expect(header.kind).toBe("header");
      expect(header.required).toBe(false);
      expect(header.text).toBe("");
      expect(header.styleName).toBeNull();
    });

    it("reads every unreadable font property as null", () => {
      const header = HeaderFooterSnapshotSchema.parse({
        index: 0,
        kind: "footer",
        font: { name: "", size: 0 },
      });
      // A zero size is preserved, because Word serves a real zero for a blank slot
      // and it is a *value* — acquisition reads it through `numberOrNull`, which
      // keeps a finite number. The emphasis fields default to null, "not read",
      // and those are the ones the analyzer skips on.
      expect(header.font?.size).toBe(0);
      expect(header.font?.bold).toBeNull();
      expect(header.font?.color).toBeNull();
      expect(header.font?.italic).toBeNull();
      expect(header.font?.underline).toBeNull();
      /*
       * An empty name becomes `null`, not `""`.
       *
       * It did not, and `checkHeaderFooterFormatting` tests
       * `actual === null || actual === undefined` before comparing — so a `""`
       * would have been compared against the profile's font name and produced a
       * "header carries '' but should be Calibri" finding on a header whose font
       * was never read. Acquisition never supplied one (`fontValue` maps anything
       * else to null), so there was no production path; the schema is where a
       * DTO's own contract belongs, and this is the fix.
       */
      expect(header.font?.name).toBeNull();
    });

    it("rejects a kind that is neither header nor footer", () => {
      expect(() => HeaderFooterSnapshotSchema.parse({ index: 0, kind: "margin" })).toThrow();
    });
  });

  describe("the snapshot itself", () => {
    it("defaults the structural collections to empty rather than absent", () => {
      /*
       * `[]`, not absent. A host that served no tables gives an empty list, and
       * `snapshot.tables ?? []` at every consumer was a guard against exactly this
       * ambiguity. The distinction that matters is preserved elsewhere: a host
       * that could not read tables is recorded in `coverage.unsupported`, which
       * is the difference between "this document has no tables" and "we could not
       * look".
       */
      const snapshot = FormattingSnapshotSchema.parse({
        id: "snapshot-1",
        text: "Body.",
        capturedAt: "2026-01-01T00:00:00.000Z",
      });
      expect(snapshot.tables).toEqual([]);
      expect(snapshot.sections).toEqual([]);
      expect(snapshot.headersFooters).toEqual([]);
      expect(snapshot.paragraphs).toEqual([]);
    });

    it("defaults the analysis window to the whole document", () => {
      const snapshot = FormattingSnapshotSchema.parse({
        id: "snapshot-1",
        text: "Body.",
        capturedAt: "2026-01-01T00:00:00.000Z",
      });
      expect(snapshot.analysisStart).toBe(0);
      expect(snapshot.analysisTruncated).toBe(false);
    });

    it("requires a capturedAt that is a real timestamp", () => {
      // The default is not `new Date()`. A snapshot whose capture time is
      // guessed would let two runs look simultaneous to any freshness
      // comparison, and freshness is what invalidates stale findings.
      expect(() =>
        FormattingSnapshotSchema.parse({ id: "s", text: "B", capturedAt: "whenever" }),
      ).toThrow();
    });
  });
});
