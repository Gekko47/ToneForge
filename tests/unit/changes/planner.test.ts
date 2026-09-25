import { describe, expect, it } from "vitest";
import { ChangeSchema, type Change } from "../../../src/core/domain/Change";
import type { ChangePlan } from "../../../src/core/domain/ChangePlan";
import {
  FindingSchema,
  type Finding,
  type Range,
  type Severity,
} from "../../../src/core/domain/Finding";
import {
  createChangePlanFromFindings,
  planChanges,
  type PlanOptions,
} from "../../../src/changes/planner";

const FINDING_ID = "11111111-1111-4111-8111-111111111111";

function finding(params: {
  category: string;
  start: number;
  end: number;
  unit?: Range["unit"];
  kind?: Finding["kind"];
  message?: string;
  severity?: Severity;
  evidence?: string;
  actual?: string;
  expected?: string;
  transformation?: Finding["transformation"];
  confidence?: number;
  suggestedChangeId?: string;
  id?: string;
}): Finding {
  return {
    id: params.id ?? FINDING_ID,
    kind: params.kind ?? "deterministic",
    category: params.category,
    range: {
      start: params.start,
      end: params.end,
      unit: params.unit ?? "character",
    },
    message: params.message ?? `Finding for ${params.category}`,
    severity: params.severity ?? "warning",
    evidence: params.evidence ?? "",
    confidence: params.confidence ?? 1,
    nodeIds: [],
    source: "deterministic",
    risk: "none",
    reversible: true,
    status: "new",
    ...(params.actual === undefined ? {} : { actual: params.actual }),
    ...(params.expected === undefined ? {} : { expected: params.expected }),
    ...(params.transformation === undefined ? {} : { transformation: params.transformation }),
    ...(params.suggestedChangeId === undefined
      ? {}
      : { suggestedChangeId: params.suggestedChangeId }),
  };
}

function planFor(
  findings: Finding[],
  options: Partial<Omit<PlanOptions, "findings">> = {},
): ChangePlan {
  return planChanges({
    findings,
    docHash: "hash-before",
    baseDocId: "doc-1",
    ...options,
  });
}

function soleChange(plan: ChangePlan): Change {
  expect(plan.changes).toHaveLength(1);
  const change = plan.changes[0];
  expect(change).toBeDefined();
  return change as NonNullable<typeof change>;
}

describe("planChanges", () => {
  it("creates an empty validated plan without findings", () => {
    const plan = planFor([]);

    expect(plan.changes).toEqual([]);
    expect(plan.findings).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.stale).toBe(false);
    expect(plan.docHash).toBe("hash-before");
    expect(plan.baseDocId).toBe("doc-1");
    expect(plan.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it.each([
    ["typography.emDash", "Use em dash (—) instead of double hyphen (--)", "—"],
    ["typography.emDash", "Use double hyphen (--) instead of em dash (—)", "--"],
    ["typography.emDash", "Use a plain space instead of em dash (—) or double hyphen (--)", " "],
    ["typography.emDashSpacing", "Em dash should be tight (no surrounding spaces): use —", "—"],
    ["typography.emDashSpacing", "Em dash should be spaced (surrounded by spaces): use —", " — "],
    ["typography.enDashSpacing", "En dash should be tight (no surrounding spaces): use –", "–"],
    ["typography.enDashSpacing", "En dash should be spaced (surrounded by spaces): use –", " – "],
    [
      "typography.doubleQuotes",
      'Use curly double quotes (“ ”) instead of straight double quote (")',
      "”",
    ],
    [
      "typography.doubleQuotes",
      'Use straight double quote (") instead of curly double quotes (“ ”)',
      '"',
    ],
    [
      "typography.singleQuotes",
      "Use curly single quotes (‘ ’) instead of straight single quote (')",
      "’",
    ],
    [
      "typography.singleQuotes",
      "Use straight single quote (') instead of curly single quotes (‘ ’)",
      "'",
    ],
    ["typography.apostrophes", "Use curly apostrophe (’) instead of straight apostrophe (')", "’"],
    ["typography.apostrophes", "Use straight apostrophe (') instead of curly apostrophe (’)", "'"],
    ["typography.decimalSeparator", "Use dot (.) as the decimal separator", "."],
    ["typography.decimalSeparator", "Use comma (,) as the decimal separator", ","],
    ["typography.thousandsSeparator", "Remove the thousands separator", ""],
    ["typography.thousandsSeparator", "Use a comma (,) as the thousands separator", ","],
    ["typography.thousandsSeparator", "Use a space ( ) as the thousands separator", " "],
    ["typography.ellipsis", "Use ellipsis character (…) instead of three dots (...)", "…"],
    ["typography.ellipsis", "Use three dots (...) instead of ellipsis character (…)", "..."],
    [
      "typography.ellipsis",
      "Use spaced dots (. . .) instead of ellipsis (…) or three dots (...)",
      ". . .",
    ],
    ["typography.whitespace", "Use a single space instead of multiple consecutive spaces", " "],
    ["typography.whitespace", "Remove trailing spaces", ""],
    ["typography.whitespace", "Use spaces instead of tabs", " "],
    ["typography.whitespace", "Use a regular space instead of a non-breaking space", " "],
  ])("maps %s to the message-specific replacement", (category, message, replacement) => {
    const plan = planFor([finding({ category, start: 2, end: 5, message })]);
    const change = soleChange(plan);

    expect(change.range).toEqual({ start: 2, end: 5 });
    if (replacement.length === 0) {
      expect(change.type).toBe("deleteRange");
      expect(change.payload).toEqual({});
    } else {
      expect(change.type).toBe("replaceText");
      expect(change.payload).toEqual({ text: replacement });
    }
    expect(change.rationale).toBe(message);
  });

  it("maps an empty-range typography insertion", () => {
    const plan = planFor([
      finding({
        category: "typography.emDash",
        start: 4,
        end: 4,
        message: "Use em dash (—) instead of double hyphen (--)",
      }),
    ]);

    expect(soleChange(plan)).toMatchObject({
      type: "insertText",
      range: { start: 4, end: 4 },
      payload: { text: "—" },
    });
  });

  it("maps preferred terminology to a replacement and preserves linkage", () => {
    const plan = planFor([
      finding({
        category: "houseStyle.terminology",
        start: 0,
        end: 11,
        message: "Use “cloud native” instead of “cloud-native”",
        evidence: "cloud-native",
        suggestedChangeId: "terminology-42",
      }),
    ]);

    expect(soleChange(plan)).toMatchObject({
      type: "replaceText",
      payload: { text: "cloud native" },
      suggestedChangeId: "terminology-42",
    });
  });

  it("extracts the preferred term from spelling-variant messages", () => {
    const plan = planFor([
      finding({
        category: "houseStyle.spellingVariant",
        start: 0,
        end: 6,
        message: "Use en-US spelling “color” instead of “colour”",
        evidence: "colour",
      }),
    ]);

    expect(soleChange(plan).payload).toEqual({ text: "color" });
  });

  it("maps capitalization findings to the cased character", () => {
    const sentenceCase = planFor([
      finding({
        category: "houseStyle.capitalization.sentenceCase",
        start: 0,
        end: 1,
        message: "Start the sentence with uppercase “c”",
        evidence: "c",
      }),
    ]);
    const titleCase = planFor([
      finding({
        category: "houseStyle.capitalization.titleCase",
        start: 8,
        end: 9,
        message: "Capitalize title-case word “introduction”",
        evidence: "i",
      }),
    ]);

    expect(soleChange(sentenceCase).payload).toEqual({ text: "C" });
    expect(soleChange(titleCase).payload).toEqual({ text: "I" });
  });

  it("prefers a title-case finding's expected character over whole-word transformation metadata", () => {
    const plan = planFor([
      finding({
        category: "houseStyle.capitalization.titleCase",
        start: 10,
        end: 11,
        evidence: "i",
        actual: "i",
        expected: "I",
        transformation: { kind: "case", style: "title", text: "introduction" },
      }),
    ]);

    expect(soleChange(plan)).toMatchObject({
      type: "replaceText",
      range: { start: 10, end: 11 },
      payload: { text: "I" },
      precondition: { kind: "text", expectedText: "i" },
    });
  });

  it("maps banned terms to non-reversible deletions", () => {
    const plan = planFor([
      finding({
        category: "houseStyle.bannedTerm",
        start: 3,
        end: 9,
        message: "Remove banned term “term”",
        severity: "error",
      }),
    ]);

    expect(soleChange(plan)).toMatchObject({
      type: "deleteRange",
      reversible: false,
      payload: {},
    });
  });

  it.each(["formatting.unknownStyle", "formatting.emptyStyle", "formatting.emptyHeading"])(
    "maps %s to Normal",
    (category) => {
      const plan = planFor([finding({ category, start: 1, end: 2, unit: "paragraph" })]);

      expect(soleChange(plan)).toMatchObject({
        type: "applyStyle",
        range: { start: 1, end: 2 },
        payload: { styleName: "Normal" },
      });
    },
  );

  it("derives the intermediate heading level from the finding message", () => {
    const plan = planFor([
      finding({
        category: "formatting.headingHierarchy",
        start: 2,
        end: 3,
        unit: "paragraph",
        message:
          'Heading level skipped: "Heading 3" follows "Heading 1" without an intermediate level',
      }),
    ]);

    expect(soleChange(plan).payload).toEqual({ styleName: "Heading 2" });
  });

  it("maps direct formatting findings to a reset that restores style control", () => {
    const plan = planFor([
      finding({
        category: "formatting.directFormatting",
        start: 0,
        end: 1,
        unit: "paragraph",
        message:
          "Paragraph has direct character formatting; clear it so the applied Word style controls appearance",
      }),
    ]);
    const change = soleChange(plan);

    expect(change.type).toBe("resetCharacterFormatting");
    expect(change.payload).toEqual({});
    expect(ChangeSchema.safeParse(change).success).toBe(true);
  });

  it("maps list-level findings to level zero", () => {
    const plan = planFor([
      finding({
        category: "formatting.listLevel",
        start: 4,
        end: 5,
        unit: "paragraph",
        message: 'Paragraph has list level 2 but style "List Paragraph" is not a list style',
      }),
    ]);

    expect(soleChange(plan)).toMatchObject({
      type: "setListLevel",
      payload: { level: 0 },
    });
  });

  it("retains semantic findings for future review without inventing a change", () => {
    const semantic = finding({
      category: "semantic.tone",
      start: 0,
      end: 12,
      kind: "semantic",
      message: "Consider a warmer opening for this paragraph.",
      confidence: 0.72,
      suggestedChangeId: "semantic-review-7",
    });
    const plan = planFor([semantic]);

    expect(plan.changes).toEqual([]);
    expect(plan.findings).toEqual([semantic]);
  });

  it("converts an explicit semantic replacement when its evidence identifies the range", () => {
    const plan = planFor([
      finding({
        category: "semantic.rewrite",
        start: 5,
        end: 10,
        kind: "semantic",
        message: "Replace “oldie” with “newer”",
        evidence: "oldie",
        suggestedChangeId: "semantic-change-9",
      }),
    ]);

    expect(soleChange(plan)).toMatchObject({
      type: "replaceText",
      payload: { text: "newer" },
      suggestedChangeId: "semantic-change-9",
    });
  });

  it("allows evidence-free semantic insertions but not evidence-free replacements", () => {
    const insertion = planFor([
      finding({
        category: "semantic.insert",
        start: 3,
        end: 3,
        kind: "semantic",
        message: "Change the transition to “Meanwhile”",
      }),
    ]);
    const replacement = planFor([
      finding({
        category: "semantic.rewrite",
        start: 3,
        end: 8,
        kind: "semantic",
        message: "Replace the phrase with “new phrase”",
      }),
    ]);

    expect(soleChange(insertion)).toMatchObject({
      type: "insertText",
      payload: { text: "Meanwhile" },
    });
    expect(replacement.changes).toEqual([]);
    expect(replacement.findings).toHaveLength(1);
  });

  it("silently skips invalid and inverted findings", () => {
    const invalidId = { ...finding({ category: "unknown", start: 0, end: 1 }), id: "bad" };
    const inverted = finding({ category: "unknown", start: 5, end: 2 });
    const plan = planFor([
      invalidId as unknown as Finding,
      inverted as unknown as Finding,
      finding({ category: "unknown", start: 0, end: 1, message: "kept" }),
    ]);

    expect(plan.changes).toEqual([]);
    expect(plan.findings).toEqual([expect.objectContaining({ message: "kept" })]);
    expect(FindingSchema.safeParse(inverted).success).toBe(false);
  });

  it("rejects invalid plan identity fields through the domain schema", () => {
    expect(() => planChanges({ findings: [], docHash: "", baseDocId: "doc-1" })).toThrow();
    expect(() => planChanges({ findings: [], docHash: "hash", baseDocId: "" })).toThrow();
  });

  it("handles a large mixed finding list deterministically", () => {
    const findings = Array.from({ length: 250 }, (_, index) =>
      finding({
        category: index % 2 === 0 ? "typography.whitespace" : "houseStyle.terminology",
        start: index * 2,
        end: index * 2 + 1,
        message:
          index % 2 === 0
            ? "Use a single space instead of multiple consecutive spaces"
            : `Use “preferred ${index}” instead of “source ${index}”`,
        id: `11111111-1111-4111-8111-${index.toString().padStart(12, "0")}`,
      }),
    );

    const plan = planFor(findings);

    expect(plan.changes).toHaveLength(findings.length);
    expect(plan.findings).toEqual(findings);
    expect(plan.conflicts).toEqual([]);
    expect(plan.changes.every((change) => ChangeSchema.safeParse(change).success)).toBe(true);
  });

  it("exposes the factory-style alias", () => {
    expect(createChangePlanFromFindings).toBe(planChanges);

    const options: PlanOptions = { findings: [], docHash: "hash", baseDocId: "doc" };
    expect(createChangePlanFromFindings(options).baseDocId).toBe("doc");
  });
});
