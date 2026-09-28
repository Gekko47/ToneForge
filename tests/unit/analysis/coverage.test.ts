import { describe, expect, it } from "vitest";
import { buildCoverage } from "../../../src/analysis/coverage";
import {
  CoverageReportSchema,
  DocumentNodeSchema,
} from "../../../src/core/domain/DocumentSnapshot";
import { v4 as uuidv4 } from "uuid";

function makeNode(
  type: string,
  text: string = "sample text",
  sourcePath: string = `body/${type}s/0`,
  includedInGovernance: boolean = true,
): ReturnType<typeof DocumentNodeSchema.parse> {
  return DocumentNodeSchema.parse({
    nodeId: uuidv4(),
    type: type as "paragraph",
    text,
    sourcePath,
    editable: true,
    includedInGovernance,
    includedInAIReview: includedInGovernance,
    ...(includedInGovernance ? {} : { protectionReason: "Protected text" }),
  });
}

describe("buildCoverage", () => {
  it("counts nodes by type", () => {
    const nodes = [
      makeNode("paragraph", "Hello world"),
      makeNode("paragraph", "Second paragraph"),
      makeNode("heading", "Title"),
    ];
    const report = buildCoverage({ nodes, text: "Hello world\nSecond paragraph\nTitle" });
    const paragraphCount = report.counts.find((c) => c.nodeType === "paragraph");
    const headingCount = report.counts.find((c) => c.nodeType === "heading");
    expect(paragraphCount?.count).toBe(2);
    expect(headingCount?.count).toBe(1);
  });

  it("computes processed character count", () => {
    const nodes = [makeNode("paragraph", "Hello"), makeNode("paragraph", "World")];
    const report = buildCoverage({ nodes, text: "Hello\nWorld" });
    expect(report.processedCharacterCount).toBe(10);
  });

  it("reports complete when no exclusions", () => {
    const nodes = [makeNode("body"), makeNode("paragraph")];
    const report = buildCoverage({ nodes, text: "hello" });
    expect(report.complete).toBe(true);
    expect(report.unprocessed).toEqual([]);
  });

  it("marks incomplete when a caller-required node type is missing", () => {
    // `requiredNodeTypes` is now opt-in. The check is still a real one when a
    // caller asks for a specific type; what is gone is the hardcoded default
    // that asked every document whether it happened to contain a paragraph.
    const nodes = [makeNode("textBox")];
    const report = buildCoverage({
      nodes,
      text: "hello",
      requiredNodeTypes: ["paragraph"],
    });
    expect(report.complete).toBe(false);
    expect(report.unprocessed).toContain("Required in-scope node type inaccessible: paragraph");
  });

  it("marks incomplete when no in-scope content was acquired at all", () => {
    // The one condition that genuinely means "we read nothing". A body node
    // with no text, and nothing else, is the shape of a failed acquisition.
    const report = buildCoverage({ nodes: [makeNode("body", "")], text: "" });
    expect(report.complete).toBe(false);
    expect(report.unprocessed).toContain("No in-scope document content was acquired");
  });

  it("handles empty nodes array", () => {
    const report = buildCoverage({ nodes: [], text: "" });
    expect(report.counts).toEqual([]);
    expect(report.processedCharacterCount).toBe(0);
    expect(report.complete).toBe(false);
    expect(report.unprocessed).toContain("No in-scope document content was acquired");
  });

  /*
   * Regression, from live Word.
   *
   * A document made entirely of list items produced
   * `Required in-scope node type inaccessible: paragraph/heading`, was marked
   * incomplete, and therefore could never be applied — even though ToneForge
   * had read it end to end and found real problems in it. `complete` drives the
   * Apply gate, so a check that misfires does not merely mislabel a report; it
   * denies the user the one action the product exists to offer.
   */
  it("reports a document of nothing but list items as complete", () => {
    const nodes = [
      makeNode("body", "Some document text", "body/0"),
      makeNode("listItem", "First item"),
      makeNode("listItem", "Second item"),
    ];
    const report = buildCoverage({
      nodes,
      text: "Some document text",
      acquisition: {
        structuralCoverage: "partial",
        unsupported: ["tables", "headers", "footers"],
        analyzedCharacterCount: 20,
        completeDocumentCharacterCount: 20,
      },
    });

    expect(report.unprocessed).toEqual([]);
    expect(report.complete).toBe(true);
  });

  it("does not report declared unsupported containers as an incomplete analysis", () => {
    // Tables and headers being unsupported is a *fact about the host*, and it
    // is already visible in `unsupported`. It is not a processing gap, so it
    // must not withhold Apply from the parts of the document that were read.
    const nodes = [
      makeNode("body", "Some document text", "body/0"),
      makeNode("paragraph", "A readable paragraph"),
    ];
    const report = buildCoverage({
      nodes,
      text: "Some document text",
      acquisition: {
        structuralCoverage: "partial",
        unsupported: ["tables", "headers", "footers", "sections", "fields"],
        analyzedCharacterCount: 20,
        completeDocumentCharacterCount: 20,
      },
    });

    expect(report.unsupported).toHaveLength(5);
    expect(report.complete).toBe(true);
  });

  it("keeps declared exclusions visible without making the requested scope incomplete", () => {
    const nodes = [makeNode("body"), makeNode("paragraph"), makeNode("caption")];
    const report = buildCoverage({
      nodes,
      text: "hello\ncaption text",
      exclusions: [{ reason: "captions excluded", nodeTypes: ["caption"] }],
      acquisition: {
        structuralCoverage: "partial",
        unsupported: ["tables", "headers", "footers"],
        analyzedCharacterCount: 22,
        completeDocumentCharacterCount: 22,
      },
    });
    expect(report.excluded).toHaveLength(1);
    expect(report.excluded[0]!.reason).toBe("captions excluded");
    expect(report.excluded[0]!.locations).toContain("body/captions/0");
    expect(report.unsupported).toEqual(["tables", "headers", "footers"]);
    expect(report.complete).toBe(true);
  });

  it("marks an unexpectedly truncated analysis window incomplete", () => {
    const nodes = [makeNode("body"), makeNode("paragraph")];
    const report = buildCoverage({
      nodes,
      text: "hello",
      acquisition: {
        structuralCoverage: "partial",
        unsupported: ["tables"],
        analyzedCharacterCount: 5,
        completeDocumentCharacterCount: 50,
      },
    });
    expect(report.complete).toBe(false);
    expect(report.unprocessed).toContain("Analysis window is shorter than the complete document");
  });

  it("does not count excluded nodes as a discovered required type", () => {
    const nodes = [
      makeNode("body", "hello", "body/0"),
      makeNode("paragraph", "protected", "body/paragraphs/0", false),
    ];
    const report = buildCoverage({
      nodes,
      text: "hello\nprotected",
      requiredNodeTypes: ["paragraph"],
    });

    // A protected node is not a node governance can act on, so requiring one
    // and finding only the protected copy is a genuine gap. This is the case
    // the check was written for, and it is why the check stays available.
    expect(report.unprocessed).toContain("Required in-scope node type inaccessible: paragraph");
    expect(report.excluded.map((entry) => entry.reason)).toContain("Protected text");
  });

  it("generates a unique runId each call", () => {
    const nodes = [makeNode("paragraph")];
    const report1 = buildCoverage({ nodes, text: "hello" });
    const report2 = buildCoverage({ nodes, text: "hello" });
    expect(report1.runId).not.toBe(report2.runId);
  });

  /*
   * Regression: the coverage schema declared `incremental: z.literal(false)`
   * while `buildCoverage` set the field from its caller. A narrowed scan
   * therefore failed its own schema parse, and the observer surfaced that as a
   * failed scan — so the incremental path reported "could not scan" for every
   * document where it would have worked. The parse is asserted here, not just
   * the value, because the value alone passes with a schema that would still
   * reject it in production.
   */
  it("round-trips a report that declares a narrowed scope", () => {
    // Shaped like the observer really builds it: the narrowed set *is* the node
    // list, and `examinedNodeIds` covers all of it. A run does not exclude a
    // required node type from its own list — it never had that node to examine.
    const nodes = [makeNode("body", "Hello", "body/0"), makeNode("heading", "Title", "body/1")];
    const report = buildCoverage({
      nodes,
      text: "Hello Title",
      acquisition: {
        structuralCoverage: "complete",
        unsupported: [],
        analyzedCharacterCount: 11,
        completeDocumentCharacterCount: 11,
      },
      examinedNodeIds: nodes.map((node) => node.nodeId),
      incremental: true,
      incrementalReason: "Word reported 1 changed paragraph.",
    });

    const parsed = CoverageReportSchema.parse(report);
    expect(parsed.acquisition?.incremental).toBe(true);
    expect(parsed.acquisition?.incrementalReason).toBe("Word reported 1 changed paragraph.");
    // Narrowed is not the same as broken: the nodes it did examine were still
    // fully processed, so it must not be reported as an incomplete analysis.
    // The two facts are separate, and conflating them would make every
    // incremental scan refuse to apply.
    expect(parsed.complete).toBe(true);
  });

  it("round-trips a full-scope report without an incremental claim", () => {
    const nodes = [makeNode("paragraph", "Hello")];
    const report = buildCoverage({
      nodes,
      text: "Hello",
      acquisition: {
        structuralCoverage: "complete",
        unsupported: [],
        analyzedCharacterCount: 5,
        completeDocumentCharacterCount: 5,
      },
    });

    const parsed = CoverageReportSchema.parse(report);
    expect(parsed.acquisition?.incremental).toBe(false);
  });
});
