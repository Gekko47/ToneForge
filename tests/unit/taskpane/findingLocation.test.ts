import { describe, expect, it } from "vitest";
import { describeFindingLocation } from "../../../src/taskpane/findingLocation";
import { FindingTargetSchema, RangeSchema, type Range } from "../../../src/core/domain/Finding";

const at = (start: number, end: number, unit: Range["unit"]) =>
  RangeSchema.parse({ start, end, unit });

describe("describeFindingLocation", () => {
  /*
   * The defect this module exists for. A table deviation produced
   * `Location: 2–3 (section)` in the task pane, because `sectionRange` had been
   * reused for tables, headers and sections alike: the numbers meant a table
   * index under a section's name. A reader could not act on it.
   */
  it("names the structure a structural target points at, not the range's unit", () => {
    expect(
      describeFindingLocation({
        range: at(2, 3, "table"),
        target: FindingTargetSchema.parse({ kind: "table", index: 2 }),
      }),
    ).toBe("Table 3");
  });

  it("says which section a header belongs to", () => {
    expect(
      describeFindingLocation({
        range: at(5, 6, "header"),
        target: FindingTargetSchema.parse({
          kind: "header",
          sectionIndex: 1,
          index: 5,
        }),
      }),
    ).toBe("Header 6 in section 2");
  });

  it("says which section a footer belongs to", () => {
    expect(
      describeFindingLocation({
        range: at(0, 1, "footer"),
        target: FindingTargetSchema.parse({ kind: "footer", sectionIndex: 0, index: 0 }),
      }),
    ).toBe("Footer 1 in section 1");
  });

  it("names a section, a paragraph and a list item", () => {
    expect(
      describeFindingLocation({
        range: at(3, 4, "section"),
        target: FindingTargetSchema.parse({ kind: "section", index: 3 }),
      }),
    ).toBe("Section 4");
    expect(
      describeFindingLocation({
        range: at(1, 2, "paragraph"),
        target: FindingTargetSchema.parse({ kind: "paragraph", index: 1 }),
      }),
    ).toBe("Paragraph 2");
    expect(
      describeFindingLocation({
        range: at(7, 8, "paragraph"),
        target: FindingTargetSchema.parse({ kind: "list", paragraphIndex: 7 }),
      }),
    ).toBe("List in paragraph 8");
  });

  it("prefers the target over the range even when the two disagree", () => {
    // They should never disagree in production; if they do, the target is the
    // one that names the thing, and hiding it would hide the defect.
    expect(
      describeFindingLocation({
        range: at(0, 1, "section"),
        target: FindingTargetSchema.parse({ kind: "table", index: 0 }),
      }),
    ).toBe("Table 1");
  });

  it("falls back to the range when there is no target", () => {
    expect(describeFindingLocation({ range: at(10, 14, "character") })).toBe("Characters 11–14");
    expect(describeFindingLocation({ range: at(2, 3, "paragraph") })).toBe("Paragraph 3");
    expect(describeFindingLocation({ range: at(4, 5, "table") })).toBe("Table 5");
  });

  it("counts from one, because a reader counts tables from one", () => {
    expect(describeFindingLocation({ range: at(0, 0, "character") })).toBe("Character 1");
    expect(
      describeFindingLocation({
        range: at(0, 1, "table"),
        target: FindingTargetSchema.parse({ kind: "table", index: 0 }),
      }),
    ).toBe("Table 1");
  });

  it("describes a text target in characters", () => {
    expect(
      describeFindingLocation({
        range: at(0, 3, "character"),
        target: FindingTargetSchema.parse({ kind: "text", start: 0, end: 3 }),
      }),
    ).toBe("Characters 1–3");
    expect(
      describeFindingLocation({
        range: at(0, 1, "character"),
        target: FindingTargetSchema.parse({ kind: "text", start: 4, end: 4 }),
      }),
    ).toBe("Character 5");
  });
});

describe("FindingTargetSchema", () => {
  const kinds = ["text", "paragraph", "list", "table", "header", "footer", "section"] as const;

  it("admits exactly the structural kinds the plan names, and nothing else", () => {
    kinds.forEach((kind) => {
      const value: Readonly<Record<string, unknown>> =
        kind === "text"
          ? { kind, start: 0, end: 1 }
          : kind === "header" || kind === "footer"
            ? { kind, sectionIndex: 0, index: 0 }
            : kind === "list"
              ? { kind, paragraphIndex: 0 }
              : { kind, index: 0 };
      expect(FindingTargetSchema.parse(value).kind).toBe(kind);
    });
    expect(FindingTargetSchema.safeParse({ kind: "document" }).success).toBe(false);
  });

  it("requires a header or footer to say which section it is in", () => {
    expect(FindingTargetSchema.safeParse({ kind: "header", index: 0 }).success).toBe(false);
    expect(
      FindingTargetSchema.safeParse({ kind: "header", sectionIndex: 0, index: 0 }).success,
    ).toBe(true);
  });

  it("carries an optional node id and structural path on every structural kind", () => {
    expect(
      FindingTargetSchema.parse({
        kind: "table",
        index: 1,
        nodeId: "word-table-1",
        structuralPath: "body/table/1",
      }),
    ).toEqual({ kind: "table", index: 1, nodeId: "word-table-1", structuralPath: "body/table/1" });
  });
});

describe("RangeSchema", () => {
  it("admits the three structural units beside the three original ones", () => {
    ["table", "header", "footer"].forEach((unit) => {
      expect(RangeSchema.parse({ start: 0, end: 1, unit }).unit).toBe(unit);
    });
    expect(RangeSchema.parse({ start: 0, end: 1 }).unit).toBe("character");
  });
});
