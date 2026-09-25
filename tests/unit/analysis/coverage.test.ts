import { describe, expect, it } from "vitest";
import { buildCoverage } from "../../../src/analysis/coverage";
import { DocumentNodeSchema } from "../../../src/core/domain/DocumentSnapshot";
import { v4 as uuidv4 } from "uuid";

function makeNode(
  type: string,
  text: string = "sample text",
  sourcePath: string = `body/${type}s/0`,
): ReturnType<typeof DocumentNodeSchema.parse> {
  return DocumentNodeSchema.parse({
    nodeId: uuidv4(),
    type: type as "paragraph",
    text,
    sourcePath,
    editable: true,
    includedInGovernance: true,
    includedInAIReview: true,
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

  it("marks incomplete when required nodes are missing", () => {
    const nodes = [makeNode("textBox")];
    const report = buildCoverage({ nodes, text: "hello" });
    expect(report.complete).toBe(false);
    expect(report.unprocessed).toContain("Required in-scope node type inaccessible: body");
  });

  it("handles empty nodes array", () => {
    const report = buildCoverage({ nodes: [], text: "" });
    expect(report.counts).toEqual([]);
    expect(report.processedCharacterCount).toBe(0);
    expect(report.complete).toBe(false);
    expect(report.unprocessed).toContain("Required in-scope node type inaccessible: body");
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

  it("generates a unique runId each call", () => {
    const nodes = [makeNode("paragraph")];
    const report1 = buildCoverage({ nodes, text: "hello" });
    const report2 = buildCoverage({ nodes, text: "hello" });
    expect(report1.runId).not.toBe(report2.runId);
  });
});
