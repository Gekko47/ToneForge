import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { findFormattingIssues } from "../../../src/formatting/analyzer";
import { FormattingStateSchema } from "../../../src/core/domain/Change";
import type { Change } from "../../../src/core/domain/Change";
import { matchesChangePrecondition } from "../../../src/changes/preconditions";
import type { Finding } from "../../../src/core/domain/Finding";
import type { z } from "zod";
import type { NodePreconditionSchema } from "../../../src/core/domain/Change";

type NodePrecondition = z.infer<typeof NodePreconditionSchema>;
import {
  DocumentFormattingProfileSchema,
  DocumentStructureProfileSchema,
} from "../../../src/core/domain/StyleProfile";

/*
 * The defect this file exists for.
 *
 * `paragraphPrecondition` built its `expectedFormatting` from nine of the fourteen
 * properties the paragraph rule compares. Line spacing, spacing before and after,
 * and all three indents were read by the rule and silently absent from the
 * precondition — so a finding about spacing could be approved, applied, and
 * verified while the spacing it was raised over moved underneath it. A
 * precondition that does not name a property cannot notice that property change.
 */

const profile = DocumentFormattingProfileSchema.parse({
  bodyStyle: { styleName: "Body Text", spaceAfter: 12, leftIndent: 36 },
});

const paragraph = (overrides: Record<string, unknown> = {}) => ({
  index: 0,
  nodeId: "word-paragraph-0",
  text: "A paragraph.",
  styleName: "Normal",
  alignment: null,
  lineSpacing: 1.15,
  spaceAfter: 6,
  spaceBefore: 0,
  leftIndent: 0,
  rightIndent: 0,
  firstLineIndent: 0,
  listLevel: null,
  fontName: "Calibri",
  fontSize: 11,
  fontColor: "#000000",
  bold: false,
  italic: false,
  underline: false,
  keepNext: null,
  keepLines: null,
  pageBreakBefore: null,
  ...overrides,
});

const structure = DocumentStructureProfileSchema.parse({});

function findingsFor(p: Record<string, unknown>): Finding[] {
  return findFormattingIssues({
    snapshot: {
      id: "snapshot-1",
      capturedAt: "2026-10-03T00:00:00.000Z",
      text: "A paragraph.",
      paragraphs: [paragraph(p)],
      coverage: {
        paragraphCollection: "partial",
        directFormattingProvenance: "partial",
        unsupported: [],
      },
    },
    profile,
    structure,
    capabilities: {
      supportsStyles: true,
      supportsParagraphFormat: true,
      supportsListLevel: true,
    },
  });
}

function preconditionOf(p: Record<string, unknown> = {}): NodePrecondition {
  const precondition = findingsFor(p)[0]?.precondition;
  expect(precondition?.kind).toBe("node");
  if (precondition === undefined || precondition.kind !== "node") {
    throw new Error("expected a node precondition");
  }
  return precondition;
}

function changeFor(precondition: NonNullable<Finding["precondition"]>): Change {
  return {
    id: uuidv4(),
    type: "applyStyle",
    range: { start: 0, end: 1, unit: "paragraph" },
    payload: { styleName: "Body Text" },
    precondition,
  } as Change;
}

describe("a paragraph precondition names everything the rule read", () => {
  const expected = preconditionOf().expectedFormatting;

  it.each([
    ["lineSpacing", 1.15],
    ["spaceAfter", 6],
    ["spaceBefore", 0],
    ["leftIndent", 0],
    ["rightIndent", 0],
    ["firstLineIndent", 0],
  ] as const)("names %s, which the rule compares and used to omit", (key, value) => {
    expect(expected?.[key]).toBe(value);
  });

  it("still names the properties it always named", () => {
    expect(expected?.styleName).toBe("Normal");
    expect(expected?.alignment).toBeNull();
    expect(expected?.fontName).toBe("Calibri");
    expect(expected?.bold).toBe(false);
  });

  /*
   * The other half of the item. The flow controls are `null` on every host today,
   * so naming them would assert "this paragraph has no keep-with-next" — a claim
   * nobody made. Leaving the key out says "not known", which `matchesFormatting`
   * skips, so widening the schema cannot introduce a false refusal.
   */
  it("omits the flow controls rather than pinning them to a value nobody read", () => {
    expect(Object.keys(expected ?? {})).not.toContain("keepNext");
    expect(Object.keys(expected ?? {})).not.toContain("keepLines");
    expect(Object.keys(expected ?? {})).not.toContain("pageBreakBefore");
  });
});

describe("the schema can name what a precondition names", () => {
  it("admits the three indents and the three flow controls", () => {
    const parsed = FormattingStateSchema.parse({
      leftIndent: 36,
      rightIndent: 0,
      firstLineIndent: -18,
      keepNext: true,
      keepLines: false,
      pageBreakBefore: null,
    });
    expect(parsed.leftIndent).toBe(36);
    expect(parsed.firstLineIndent).toBe(-18);
    expect(parsed.keepNext).toBe(true);
    expect(parsed.pageBreakBefore).toBeNull();
  });

  it("leaves every field optional, so an absent key still means not known", () => {
    const parsed = FormattingStateSchema.parse({});
    expect(Object.keys(parsed)).toEqual([]);
  });
});

describe("a moved indentation now refuses the change", () => {
  const precondition = preconditionOf();

  it("matches when the paragraph still reads as the rule found it", () => {
    const result = matchesChangePrecondition(changeFor(precondition), {
      nodeId: "word-paragraph-0",
      text: "A paragraph.",
      styleName: "Normal",
      formatting: paragraph(),
    });
    expect(result).toEqual({ matches: true });
  });

  it("refuses when the left indent moved, which it could not see before", () => {
    const moved = paragraph({ leftIndent: 72 });
    const result = matchesChangePrecondition(changeFor(precondition), {
      nodeId: "word-paragraph-0",
      text: "A paragraph.",
      styleName: "Normal",
      formatting: moved,
    });
    expect(result.matches).toBe(false);
    expect(result.reason).toContain("leftIndent");
  });

  it("refuses when the space after moved", () => {
    const moved = paragraph({ spaceAfter: 24 });
    const result = matchesChangePrecondition(changeFor(precondition), {
      nodeId: "word-paragraph-0",
      text: "A paragraph.",
      styleName: "Normal",
      formatting: moved,
    });
    expect(result.matches).toBe(false);
    expect(result.reason).toContain("spaceAfter");
  });

  it("does not refuse on a flow control the read side never serves", () => {
    // The live read has no `keepNext` key at all. Comparing it against the
    // absent expectation must match rather than invent a refusal.
    const live = paragraph();
    const result = matchesChangePrecondition(changeFor(precondition), {
      nodeId: "word-paragraph-0",
      text: "A paragraph.",
      styleName: "Normal",
      formatting: live,
    });
    expect(result.matches).toBe(true);
  });
});
