import { describe, expect, it } from "vitest";
import { buildExtractionBatches } from "../../../../../src/analysis/consistency/extraction/batch";
import type { ConsistencyDocument } from "../../../../../src/analysis/consistency/contracts";

/**
 * R2 batching tests: the document is batched by its own
 * structure, every paragraph gets a stable id and an exact
 * span, and the same document always batches the same way.
 */
function document(text: string, sections: string[] = []): ConsistencyDocument {
  return { revision: "doc-batch", text, sections };
}

describe("section-hierarchy batching", () => {
  it("batches by heading, with stable paragraph ids", () => {
    const batches = buildExtractionBatches(
      document(
        "## Programme\n\nFirst paragraph.\n\nSecond paragraph.\n\n## Quantum\n\nThird paragraph.",
        ["Programme", "Quantum"],
      ),
    );
    expect(batches.map((batch) => batch.batchId)).toEqual(["batch-1", "batch-2"]);
    expect(batches[0]?.sectionId).toBe("section-1");
    expect(batches[0]?.sectionTitle).toBe("Programme");
    expect(batches[0]?.paragraphs.map((p) => p.paragraphId)).toEqual(["p-1-0", "p-1-1"]);
    expect(batches[1]?.paragraphs.map((p) => p.paragraphId)).toEqual(["p-2-0"]);
  });

  it("keeps the section path of nested headings", () => {
    const batches = buildExtractionBatches(
      document("# Report\n\nIntro.\n\n## Delay\n\nDelay text.\n\n### Analysis\n\nDeep text.", [
        "Report",
        "Delay",
        "Analysis",
      ]),
    );
    expect(batches[0]?.sectionPath).toEqual(["Report"]);
    expect(batches[1]?.sectionPath).toEqual(["Report", "Delay"]);
    expect(batches[2]?.sectionPath).toEqual(["Report", "Delay", "Analysis"]);
  });

  it("puts text before the first heading in the opening section", () => {
    const batches = buildExtractionBatches(
      document("Opening text.\n\n## First\n\nBody.", ["First"]),
    );
    expect(batches[0]?.sectionTitle).toBe("");
    expect(batches[0]?.sectionPath).toEqual([]);
    expect(batches[0]?.paragraphs[0]?.paragraphId).toBe("p-0-0");
    expect(batches[1]?.sectionTitle).toBe("First");
  });

  it("treats a document with no headings as one batch", () => {
    const batches = buildExtractionBatches(document("Only one paragraph."));
    expect(batches).toHaveLength(1);
    expect(batches[0]?.batchId).toBe("batch-0");
    expect(batches[0]?.sectionTitle).toBe("");
    expect(batches[0]?.paragraphs[0]?.paragraphId).toBe("p-0-0");
  });

  it("gives every paragraph a span that slices back to its text", () => {
    const text = "## A\n\nFirst paragraph.\n\nSecond paragraph.";
    const batches = buildExtractionBatches(document(text));
    const paragraphs = batches[0]?.paragraphs ?? [];
    expect(paragraphs).toHaveLength(2);
    paragraphs.forEach((paragraph) => {
      expect(text.slice(paragraph.startOffset, paragraph.endOffset)).toBe(paragraph.text);
    });
  });

  it("keeps a multi-line paragraph together across single newlines", () => {
    const batches = buildExtractionBatches(document("## A\n\nLine one.\nLine two.\n\nNext."));
    expect(batches[0]?.paragraphs).toHaveLength(2);
    expect(batches[0]?.paragraphs[0]?.text).toBe("Line one.\nLine two.");
  });

  it("preserves Windows line endings in paragraph spans", () => {
    const text = "## A\r\n\r\nFirst paragraph.\r\n\r\nSecond.";
    const batches = buildExtractionBatches(document(text));
    expect(batches[0]?.paragraphs).toHaveLength(2);
    expect(batches[0]?.paragraphs[0]?.text).toBe("First paragraph.");
    expect(
      text.slice(
        batches[0]?.paragraphs[0]?.startOffset ?? 0,
        batches[0]?.paragraphs[0]?.endOffset ?? 0,
      ),
    ).toBe("First paragraph.");
  });

  it("produces no batch for a section with no paragraphs", () => {
    const batches = buildExtractionBatches(
      document("## Empty\n\n## Full\n\nBody.", ["Empty", "Full"]),
    );
    expect(batches.map((batch) => batch.sectionTitle)).toEqual(["Full"]);
  });

  it("produces no batches for an empty document", () => {
    expect(buildExtractionBatches(document(""))).toEqual([]);
    expect(buildExtractionBatches(document("\n\n"))).toEqual([]);
  });

  it("assigns the same ids for the same document", () => {
    const text = "## A\n\nBody.\n\n## B\n\nMore.";
    const first = buildExtractionBatches(document(text));
    const second = buildExtractionBatches(document(text));
    expect(second).toEqual(first);
  });
});
