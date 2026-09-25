import { describe, expect, it } from "vitest";
import { ChangeSchema } from "../../../src/core/domain/Change";
import { createChangePlan } from "../../../src/core/domain/ChangePlan";
import { FindingSchema, type Finding } from "../../../src/core/domain/Finding";
import { planChanges } from "../../../src/changes/planner";
import { findFormattingIssues } from "../../../src/formatting/analyzer";
import { toSentenceCase, toTitleCase } from "../../../src/shared/utils/caseConversion";
import type { FormattingSnapshot } from "../../../src/formatting/formattingSnapshot";

const findingId = "11111111-1111-4111-8111-111111111111";

function finding(overrides: Partial<Finding> = {}): Finding {
  return FindingSchema.parse({
    id: findingId,
    kind: "semantic",
    category: "semantic.tone",
    range: { start: 0, end: 4, unit: "character" },
    message: "Replace “old” with “new”",
    severity: "warning",
    evidence: "old",
    actual: "old",
    expected: "new",
    source: "ai",
    risk: "medium",
    status: "accepted",
    nodeIds: ["node-1"],
    ...overrides,
  });
}

describe("Stage 1-2 hardening contracts", () => {
  it("preserves complete-document identity separately from bounded analysis text", async () => {
    const { getDocumentSnapshot } = await import("../../../src/word/documentReader");
    const first = "prefix-".repeat(80_000);
    const run = async (fullText: string) => {
      (globalThis as { Office?: unknown }).Office = {
        run: async (fn: (context: unknown) => Promise<unknown>) =>
          fn({
            document: { body: { text: fullText, load: () => undefined } },
            sync: () => Promise.resolve(),
          }),
      };
      return getDocumentSnapshot({ maxChars: 100 });
    };
    const before = await run(`${first}suffix-a`);
    const after = await run(`${first}suffix-b`);
    expect(before.analysisText).toBe(before.text);
    expect(before.analysisTruncated).toBe(true);
    expect(before.fullDocumentHash).not.toBe(after.fullDocumentHash);
    expect(before.hash).toBe(after.hash);
  });

  it("copies source, risk, approval, finding linkage, rule identity, actual, and expected", () => {
    const change = planChanges({
      findings: [finding({ ruleId: "tone.warmth" })],
      docHash: "complete-hash",
      baseDocId: "doc-1",
    }).changes[0];
    expect(change).toMatchObject({
      source: "ai",
      risk: "medium",
      approvalRequired: true,
      approvalState: "approved",
      findingId,
      ruleId: "tone.warmth",
      range: { start: 0, end: 4 },
      precondition: { kind: "text", expectedText: "old" },
    });
  });

  it("rejects missing exact preconditions in schema version 2 plans", () => {
    const legacy = ChangeSchema.parse({
      id: "22222222-2222-4222-8222-222222222222",
      type: "replaceText",
      range: { start: 0, end: 1 },
      payload: { text: "x" },
      source: "ai",
      risk: "medium",
      approvalRequired: true,
      approvalState: "pending",
    });
    expect(() => createChangePlan("hash", "doc", [legacy], [], { schemaVersion: 2 })).toThrow(
      /requires an exact text or node precondition/,
    );
  });

  it("resolves formatting findings to stable node identity and direct provenance", () => {
    const paragraph = {
      index: 4,
      nodeId: "word-paragraph-abc",
      text: "Styled text",
      styleName: "Normal",
      alignment: null,
      lineSpacing: null,
      spaceAfter: null,
      spaceBefore: null,
      listLevel: null,
      fontName: "Arial",
      fontSize: 12,
      fontColor: "#000000",
      bold: true,
      italic: null,
      underline: null,
      provenance: {
        alignment: "unknown",
        lineSpacing: "unknown",
        spaceAfter: "unknown",
        spaceBefore: "unknown",
        listLevel: "unknown",
        fontName: "direct",
        fontSize: "direct",
        fontColor: "direct",
        bold: "direct",
        italic: "unknown",
        underline: "unknown",
      },
    } satisfies FormattingSnapshot["paragraphs"][number];
    const result = findFormattingIssues({
      snapshot: {
        id: "doc",
        text: paragraph.text,
        paragraphs: [paragraph],
        capturedAt: "2026-01-01T00:00:00.000Z",
        coverage: {
          paragraphCollection: "partial",
          directFormattingProvenance: "partial",
          unsupported: [],
        },
      },
    });
    expect(result[0]).toMatchObject({
      nodeIds: ["word-paragraph-abc"],
      precondition: { kind: "node", nodeId: "word-paragraph-abc" },
    });
  });

  it("ignores direct paragraph-property provenance for character-format findings", () => {
    const paragraph = {
      index: 0,
      text: "Body",
      styleName: "Normal",
      alignment: "center",
      provenance: {
        alignment: "direct",
        lineSpacing: "direct",
        spaceAfter: "direct",
        spaceBefore: "direct",
        listLevel: "direct",
        fontName: "style",
        fontSize: "style",
        fontColor: "style",
        bold: "style",
        italic: "style",
        underline: "style",
      },
    } satisfies FormattingSnapshot["paragraphs"][number];
    const findings = findFormattingIssues({
      snapshot: {
        id: "doc",
        text: paragraph.text,
        paragraphs: [paragraph],
        capturedAt: "2026-01-01T00:00:00.000Z",
        coverage: {
          paragraphCollection: "partial",
          directFormattingProvenance: "partial",
          unsupported: [],
        },
      },
    });

    expect(findings.some((item) => item.category === "formatting.directFormatting")).toBe(false);
  });

  it("converts sentence and title case without parsing prose", () => {
    expect(toSentenceCase("hello WORLD. Next sentence.")).toBe("Hello world. Next sentence.");
    expect(toTitleCase("the rise of AI")).toBe("The Rise of AI");
  });
});
