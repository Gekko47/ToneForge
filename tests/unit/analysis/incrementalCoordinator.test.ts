/**
 * Tests for the incremental coordinator — pure functions for dirty-node
 * tracking, finding merge, full-rescan decisions, and stale-run cancellation.
 */

import { describe, expect, it } from "vitest";
import {
  markDirtyNodes,
  mergeFindings,
  shouldFullRescan,
  cancelStaleRun,
  createRunId,
} from "../../../src/analysis/incrementalCoordinator";
import { v4 as uuidv4 } from "uuid";
import type { Finding, Range } from "../../../src/core/domain/Finding";
import type { DocumentNode } from "../../../src/core/domain/DocumentSnapshot";

function makeNode(id: string, text: string, type: string = "paragraph"): DocumentNode {
  return {
    nodeId: id,
    type: type as DocumentNode["type"],
    text,
    sourcePath: `${type}:${id}`,
    editable: true,
    includedInGovernance: true,
    includedInAIReview: true,
  };
}

function makeFinding(nodeIds: string[]): Finding {
  return {
    id: uuidv4(),
    kind: "deterministic",
    category: "typography.em-dash",
    range: { start: 0, end: 5, unit: "character" },
    message: "Test finding",
    severity: "error",
    nodeIds,
    source: "deterministic",
    risk: "none",
    reversible: true,
    status: "new",
    evidence: "",
    confidence: 1,
  };
}

describe("markDirtyNodes", () => {
  it("returns empty array when no nodes overlap the changed range", () => {
    const nodes = [makeNode("abc123", "hello world")];
    const range: Range = { start: 100, end: 200, unit: "character" };
    expect(markDirtyNodes(range, nodes)).toEqual([]);
  });

  it("returns nodeIds whose text overlaps the changed character range", () => {
    const nodes = [makeNode("abc123", "hello world"), makeNode("def456", "foo bar")];
    const range: Range = { start: 4, end: 8, unit: "character" };
    const result = markDirtyNodes(range, nodes);
    expect(result).toContain("abc123");
    expect(result).not.toContain("def456");
  });

  it("returns all nodeIds for paragraph-level changes", () => {
    const nodes = [makeNode("abc123", "hello"), makeNode("def456", "world")];
    const range: Range = { start: 0, end: 0, unit: "paragraph" };
    const result = markDirtyNodes(range, nodes);
    expect(result).toHaveLength(2);
    expect(result).toContain("abc123");
    expect(result).toContain("def456");
  });

  it("returns all nodeIds for section-level changes", () => {
    const nodes = [makeNode("abc123", "hello"), makeNode("def456", "world")];
    const range: Range = { start: 0, end: 0, unit: "section" };
    const result = markDirtyNodes(range, nodes);
    expect(result).toHaveLength(2);
  });

  it("handles empty nodes array", () => {
    expect(markDirtyNodes({ start: 0, end: 5, unit: "character" }, [])).toEqual([]);
  });
});

describe("mergeFindings", () => {
  it("preserves findings that do not overlap dirty nodes", () => {
    const findings = [makeFinding(["clean-node"])];
    const result = mergeFindings(findings, ["dirty-node"], () => []);
    expect(result).toHaveLength(1);
    expect(result[0]!.nodeIds).toContain("clean-node");
  });

  it("replaces findings that overlap dirty nodes", () => {
    const findings = [makeFinding(["dirty-node"])];
    const replacement = [makeFinding(["dirty-node"])];
    const result = mergeFindings(findings, ["dirty-node"], () => replacement);
    expect(result).toHaveLength(1);
    expect(result[0]!.nodeIds).toContain("dirty-node");
  });

  it("preserves clean findings and replaces dirty ones", () => {
    const findings = [makeFinding(["clean-node"]), makeFinding(["dirty-node"])];
    const replacement = [makeFinding(["dirty-node-replaced"])];
    const result = mergeFindings(findings, ["dirty-node"], () => replacement);
    expect(result).toHaveLength(2);
    const clean = result.find((f) => f.nodeIds.includes("clean-node"));
    const replaced = result.find((f) => f.nodeIds.includes("dirty-node-replaced"));
    expect(clean).toBeDefined();
    expect(replaced).toBeDefined();
  });

  it("handles empty findings array", () => {
    const result = mergeFindings([], ["dirty-node"], () => []);
    expect(result).toEqual([]);
  });

  it("handles empty dirty node ids", () => {
    const findings = [makeFinding(["some-node"])];
    const result = mergeFindings(findings, [], () => []);
    expect(result).toHaveLength(1);
  });
});

describe("shouldFullRescan", () => {
  it("returns true for heading hierarchy findings", () => {
    const findings: Finding[] = [
      {
        id: uuidv4(),
        kind: "deterministic",
        category: "formatting.headingHierarchy",
        range: { start: 0, end: 5, unit: "character" },
        message: "Test",
        severity: "error",
        nodeIds: [],
        source: "deterministic",
        risk: "none",
        reversible: true,
        status: "new",
        evidence: "",
        confidence: 1,
      },
    ];
    expect(shouldFullRescan(findings)).toBe(true);
  });

  it("returns true for list level findings", () => {
    const findings: Finding[] = [
      {
        id: uuidv4(),
        kind: "deterministic",
        category: "formatting.listLevel",
        range: { start: 0, end: 5, unit: "character" },
        message: "Test",
        severity: "error",
        nodeIds: [],
        source: "deterministic",
        risk: "none",
        reversible: true,
        status: "new",
        evidence: "",
        confidence: 1,
      },
    ];
    expect(shouldFullRescan(findings)).toBe(true);
  });

  it("returns true for houseStyle capitalization findings", () => {
    const findings: Finding[] = [
      {
        id: uuidv4(),
        kind: "deterministic",
        category: "houseStyle.capitalization.sentenceCase",
        range: { start: 0, end: 5, unit: "character" },
        message: "Test",
        severity: "error",
        nodeIds: [],
        source: "deterministic",
        risk: "none",
        reversible: true,
        status: "new",
        evidence: "",
        confidence: 1,
      },
    ];
    expect(shouldFullRescan(findings)).toBe(true);
  });

  it("returns false for typography-only findings", () => {
    const findings: Finding[] = [
      {
        id: uuidv4(),
        kind: "deterministic",
        category: "typography.em-dash",
        range: { start: 0, end: 5, unit: "character" },
        message: "Test",
        severity: "error",
        nodeIds: [],
        source: "deterministic",
        risk: "none",
        reversible: true,
        status: "new",
        evidence: "",
        confidence: 1,
      },
    ];
    expect(shouldFullRescan(findings)).toBe(false);
  });

  it("returns false for empty findings", () => {
    expect(shouldFullRescan([])).toBe(false);
  });
});

describe("cancelStaleRun", () => {
  it("returns false when runId and documentVersion match", () => {
    expect(cancelStaleRun("run-1", "v1", "run-1", "v1")).toBe(false);
  });

  it("returns true when runId differs", () => {
    expect(cancelStaleRun("run-1", "v1", "run-2", "v1")).toBe(true);
  });

  it("returns true when documentVersion differs", () => {
    expect(cancelStaleRun("run-1", "v1", "run-1", "v2")).toBe(true);
  });
});

describe("createRunId", () => {
  it("returns a valid UUID and document version", () => {
    const result = createRunId("doc-v1");
    expect(result.runId).toBeTruthy();
    expect(result.documentVersion).toBe("doc-v1");
  });
});
