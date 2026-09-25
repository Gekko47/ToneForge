import { describe, expect, it, vi } from "vitest";
import { acquireAnalysisContext } from "../../../src/word/analysisAcquisition";
import { buildCoverage } from "../../../src/analysis/coverage";
import { createEmptyProfile } from "../../../src/core/domain/StyleProfile";
import type { AnalysisCapabilities } from "../../../src/analysis/analysisContext";

const CAPABILITIES: AnalysisCapabilities = {
  supportsInsertText: true,
  supportsReplaceText: true,
  supportsInsertParagraph: true,
  supportsInsertBreak: true,
  supportsStyles: true,
  supportsParagraphFormat: true,
  supportsCharacterFormat: true,
  supportsResetCharacterFormatting: true,
  supportsListLevel: true,
  supportsRevisions: true,
  supportsSelection: true,
  supportsParagraphResolution: true,
  supportsHighlight: true,
  supportsContextMenu: true,
  hostName: "Word",
  hostVersion: "16.0",
};

function officeFor(text: string, paragraphCount = 2) {
  const paragraphs = Array.from({ length: paragraphCount }, (_, index) => ({
    text: index === 0 ? text : `Paragraph ${index}`,
    style: "Normal",
    uniqueLocalId: `paragraph-${index}`,
    load: vi.fn(),
  }));
  const body = {
    text,
    load: vi.fn(),
    paragraphs: { load: vi.fn(), items: paragraphs },
  };
  const context = {
    document: {
      id: "doc-1",
      body,
      styles: { load: vi.fn(), items: [] },
    },
    sync: vi.fn(),
  };
  const wordRun = vi.fn((callback: (value: typeof context) => Promise<unknown>) =>
    callback(context),
  );
  (globalThis as { Word?: unknown }).Word = { run: wordRun };
  return { context, wordRun, body, paragraphs };
}

describe("analysis context acquisition", () => {
  it("acquires complete identity, text, nodes, formatting, and diagnostics in one pass", async () => {
    const { wordRun, body, paragraphs } = officeFor("hello world");
    const context = await acquireAnalysisContext({
      profile: createEmptyProfile("Test"),
      capabilities: CAPABILITIES,
    });

    expect(wordRun).toHaveBeenCalledTimes(1);
    expect(context.identity.fullText).toBe("hello world");
    expect(context.text).toBe("hello world");
    expect(context.nodes).toHaveLength(3);
    expect(context.formatting.paragraphs).toHaveLength(2);
    expect(context.acquisition).toMatchObject({
      acquisitionReadCount: 1,
      fullBodyReadCount: 1,
      analyzedCharacterCount: 11,
      completeDocumentCharacterCount: 11,
      incremental: false,
    });
    expect(body.load).toHaveBeenCalledTimes(1);
    expect(paragraphs.every((paragraph) => paragraph.load.mock.calls.length === 1)).toBe(true);
  });

  it("normalizes PascalCase alignment and leaves paragraph provenance unknown", async () => {
    const { paragraphs } = officeFor("hello world", 1);
    Object.assign(paragraphs[0] ?? {}, { alignment: "Centered" });

    const context = await acquireAnalysisContext({
      profile: createEmptyProfile("Test"),
      capabilities: CAPABILITIES,
    });

    expect(context.formatting.paragraphs[0]).toMatchObject({
      alignment: "center",
      provenance: {
        alignment: "unknown",
        lineSpacing: "unknown",
        spaceAfter: "unknown",
        spaceBefore: "unknown",
        listLevel: "unknown",
      },
    });
  });

  it("does not perform a duplicate full-body read for a large synthetic input", async () => {
    const text = Array.from({ length: 50_000 }, (_, index) =>
      index % 2 === 0 ? "word " : "term ",
    ).join("");
    const { body, wordRun } = officeFor(text, 1);
    const context = await acquireAnalysisContext({
      profile: createEmptyProfile("Large"),
      capabilities: CAPABILITIES,
      maxChars: 50_000,
    });

    expect(context.acquisition.fullBodyReadCount).toBe(1);
    expect(context.acquisition.completeDocumentCharacterCount).toBe(text.length);
    expect(context.identity.analysisTruncated).toBe(true);
    expect(body.load).toHaveBeenCalledTimes(1);
    expect(wordRun).toHaveBeenCalledTimes(1);
  });
});

describe("authoritative coverage accounting", () => {
  it("reports examined, excluded, unsupported, and changed counts separately", () => {
    const nodes = [
      {
        nodeId: "body",
        type: "body" as const,
        sourcePath: "body",
        editable: true,
        includedInGovernance: true,
        includedInAIReview: true,
      },
      {
        nodeId: "paragraph",
        type: "paragraph" as const,
        text: "Hello",
        sourcePath: "body/paragraph/0",
        editable: false,
        includedInGovernance: false,
        includedInAIReview: false,
        protectionReason: "protected",
      },
    ];
    const coverage = buildCoverage({
      nodes,
      text: "Hello",
      acquisition: {
        structuralCoverage: "partial",
        unsupported: ["tables"],
        analyzedCharacterCount: 5,
        completeDocumentCharacterCount: 5,
      },
      plannedChangeCount: 1,
      appliedChangeCount: 0,
      changedNodeIds: ["body"],
      changedCharacterCount: 5,
    });

    expect(coverage.examinedNodeIds).toEqual(["body"]);
    expect(coverage.excluded).toEqual([{ reason: "protected", locations: ["body/paragraph/0"] }]);
    expect(coverage.unsupported).toEqual(["tables"]);
    expect(coverage.plannedChangeCount).toBe(1);
    expect(coverage.appliedChangeCount).toBe(0);
    expect(coverage.changedNodeIds).toEqual(["body"]);
    expect(coverage.complete).toBe(false);
  });
});
