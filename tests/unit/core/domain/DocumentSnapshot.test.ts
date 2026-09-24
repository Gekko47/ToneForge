import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  DocumentSnapshotSchema,
  DocumentNodeSchema,
  SourceRangeSchema,
  CoverageReportSchema,
  buildNodeId,
  computeStructuralHash,
} from "../../../../src/core/domain/DocumentSnapshot";
import { hashText } from "../../../../src/shared/utils/text";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("SourceRangeSchema", () => {
  it("validates a source range", () => {
    const range = SourceRangeSchema.parse({
      nodeId: UUID,
      paragraphIndex: 0,
      startOffset: 5,
      endOffset: 10,
      structuralPath: "body/paragraph/0",
    });
    expect(range.nodeId).toBe(UUID);
    expect(range.paragraphIndex).toBe(0);
    expect(range.startOffset).toBe(5);
    expect(range.endOffset).toBe(10);
    expect(range.structuralPath).toBe("body/paragraph/0");
  });

  it("allows optional fields", () => {
    const range = SourceRangeSchema.parse({ nodeId: UUID });
    expect(range.nodeId).toBe(UUID);
    expect(range.paragraphIndex).toBeUndefined();
    expect(range.startOffset).toBeUndefined();
    expect(range.endOffset).toBeUndefined();
    expect(range.structuralPath).toBeUndefined();
  });
});

describe("DocumentNodeSchema", () => {
  it("validates a paragraph node", () => {
    const node = DocumentNodeSchema.parse({
      nodeId: uuidv4(),
      type: "paragraph",
      text: "Hello world",
      sourcePath: "body/paragraph/0",
      editable: true,
      includedInGovernance: true,
      includedInAIReview: true,
    });
    expect(node.type).toBe("paragraph");
    expect(node.text).toBe("Hello world");
    expect(node.editable).toBe(true);
  });

  it("defaults editable and inclusion flags", () => {
    const node = DocumentNodeSchema.parse({
      nodeId: uuidv4(),
      type: "body",
      sourcePath: "body",
    });
    expect(node.editable).toBe(true);
    expect(node.includedInGovernance).toBe(true);
    expect(node.includedInAIReview).toBe(true);
  });

  it("allows optional text and sourceRange", () => {
    const node = DocumentNodeSchema.parse({
      nodeId: uuidv4(),
      type: "heading",
      sourcePath: "body/heading/0",
    });
    expect(node.text).toBeUndefined();
    expect(node.sourceRange).toBeUndefined();
  });

  it("allows protectionReason", () => {
    const node = DocumentNodeSchema.parse({
      nodeId: uuidv4(),
      type: "caption",
      sourcePath: "body/caption/0",
      protectionReason: "caption",
    });
    expect(node.protectionReason).toBe("caption");
  });
});

describe("CoverageReportSchema", () => {
  it("validates a coverage report", () => {
    const report = CoverageReportSchema.parse({
      runId: uuidv4(),
      counts: [
        {
          nodeType: "paragraph",
          count: 3,
          processedCharacterCount: 300,
          revisedCharacterCount: 10,
          excluded: [],
        },
      ],
      processedCharacterCount: 300,
      revisedCharacterCount: 10,
      excluded: [],
      unprocessed: [],
      complete: true,
    });
    expect(report.counts).toHaveLength(1);
    expect(report.complete).toBe(true);
  });
});

describe("buildNodeId", () => {
  it("produces a deterministic hash-based ID", () => {
    const id1 = buildNodeId("paragraph", "body/paragraph/0");
    const id2 = buildNodeId("paragraph", "body/paragraph/0");
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{8}$/);
  });

  it("produces different IDs for different inputs", () => {
    const id1 = buildNodeId("paragraph", "body/paragraph/0");
    const id2 = buildNodeId("heading", "body/heading/0");
    expect(id1).not.toBe(id2);
  });
});

describe("computeStructuralHash", () => {
  it("produces a deterministic hash from nodes", () => {
    const nodes = [
      DocumentNodeSchema.parse({ nodeId: uuidv4(), type: "body", sourcePath: "body" }),
      DocumentNodeSchema.parse({
        nodeId: uuidv4(),
        type: "paragraph",
        sourcePath: "body/paragraph/0",
      }),
    ];
    const hash1 = computeStructuralHash(nodes);
    const hash2 = computeStructuralHash(nodes);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{8}$/);
  });

  it("produces different hashes for different node sequences", () => {
    const nodes1 = [
      DocumentNodeSchema.parse({ nodeId: uuidv4(), type: "body", sourcePath: "body" }),
      DocumentNodeSchema.parse({
        nodeId: uuidv4(),
        type: "paragraph",
        sourcePath: "body/paragraph/0",
      }),
    ];
    const nodes2 = [
      DocumentNodeSchema.parse({ nodeId: uuidv4(), type: "body", sourcePath: "body" }),
      DocumentNodeSchema.parse({ nodeId: uuidv4(), type: "heading", sourcePath: "body/heading/0" }),
    ];
    expect(computeStructuralHash(nodes1)).not.toBe(computeStructuralHash(nodes2));
  });
});

describe("DocumentSnapshotSchema", () => {
  it("validates a complete snapshot", () => {
    const nodes = [
      DocumentNodeSchema.parse({ nodeId: uuidv4(), type: "body", sourcePath: "body" }),
      DocumentNodeSchema.parse({
        nodeId: uuidv4(),
        type: "paragraph",
        text: "Hello",
        sourcePath: "body/paragraph/0",
      }),
    ];
    const snapshot = DocumentSnapshotSchema.parse({
      documentId: "doc-123",
      versionToken: "v1",
      contentHash: hashText("Hello"),
      structuralHash: computeStructuralHash(nodes),
      capturedAt: "2026-01-01T00:00:00.000Z",
      nodes,
    });
    expect(snapshot.documentId).toBe("doc-123");
    expect(snapshot.nodes).toHaveLength(2);
  });

  it("allows optional coverage", () => {
    const nodes = [
      DocumentNodeSchema.parse({ nodeId: uuidv4(), type: "body", sourcePath: "body" }),
    ];
    const snapshot = DocumentSnapshotSchema.parse({
      documentId: "doc-123",
      versionToken: "v1",
      contentHash: hashText(""),
      structuralHash: computeStructuralHash(nodes),
      capturedAt: "2026-01-01T00:00:00.000Z",
      nodes,
      coverage: {
        runId: uuidv4(),
        counts: [],
        processedCharacterCount: 0,
        revisedCharacterCount: 0,
        excluded: [],
        unprocessed: [],
        complete: true,
      },
    });
    expect(snapshot.coverage).toBeDefined();
  });
});
