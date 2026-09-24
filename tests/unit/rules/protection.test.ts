import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  detectQuotedRanges,
  detectCaptionNodes,
  detectTrackedDeletionRanges,
  detectCommentRanges,
  isProtectedNode,
  isProtectedRange,
} from "../../../src/rules/protection";
import { DocumentNodeSchema } from "../../../src/core/domain/DocumentSnapshot";

function makeNode(
  type: string,
  overrides: Record<string, unknown> = {},
): ReturnType<typeof DocumentNodeSchema.parse> {
  return DocumentNodeSchema.parse({
    nodeId: uuidv4(),
    type: type as "paragraph",
    sourcePath: `body/${type}s/0`,
    editable: true,
    includedInGovernance: true,
    includedInAIReview: true,
    ...overrides,
  });
}

describe("detectQuotedRanges", () => {
  it("detects double-quoted text", () => {
    const findings = detectQuotedRanges('He said "hello"');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.protectionReason).toBe("quoted-text");
  });

  it("returns empty for no quotes", () => {
    expect(detectQuotedRanges("no quotes here")).toEqual([]);
  });

  it("detects multiple quoted ranges", () => {
    const findings = detectQuotedRanges('"first" and "second"');
    expect(findings).toHaveLength(2);
  });
});

describe("detectCaptionNodes", () => {
  it("detects caption nodes", () => {
    const nodes = [makeNode("paragraph"), makeNode("caption")];
    const findings = detectCaptionNodes(nodes);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.nodeId).toBeDefined();
    expect(findings[0]!.protectionReason).toBe("caption");
  });

  it("returns empty for no captions", () => {
    expect(detectCaptionNodes([makeNode("paragraph")])).toEqual([]);
  });
});

describe("detectTrackedDeletionRanges", () => {
  it("detects tracked deletion markers", () => {
    const findings = detectTrackedDeletionRanges("text {{DELETE old}} more text");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.protectionReason).toBe("tracked-deletion");
  });

  it("returns empty for no deletions", () => {
    expect(detectTrackedDeletionRanges("no deletions")).toEqual([]);
  });
});

describe("detectCommentRanges", () => {
  it("detects comment nodes", () => {
    const nodes = [makeNode("paragraph"), makeNode("comment")];
    const findings = detectCommentRanges(nodes);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.protectionReason).toBe("comment");
  });

  it("returns empty for no comments", () => {
    expect(detectCommentRanges([makeNode("paragraph")])).toEqual([]);
  });
});

describe("isProtectedNode", () => {
  it("returns true for non-editable nodes", () => {
    const node = makeNode("paragraph", { editable: false });
    expect(isProtectedNode(node)).toBe(true);
  });

  it("returns true for caption nodes", () => {
    const node = makeNode("caption");
    expect(isProtectedNode(node)).toBe(true);
  });

  it("returns true for comment nodes", () => {
    const node = makeNode("comment");
    expect(isProtectedNode(node)).toBe(true);
  });

  it("returns true for footnote nodes", () => {
    const node = makeNode("footnote");
    expect(isProtectedNode(node)).toBe(true);
  });

  it("returns true for textBox nodes", () => {
    const node = makeNode("textBox");
    expect(isProtectedNode(node)).toBe(true);
  });

  it("returns true for shape nodes", () => {
    const node = makeNode("shape");
    expect(isProtectedNode(node)).toBe(true);
  });

  it("returns true for smartArt nodes", () => {
    const node = makeNode("smartArt");
    expect(isProtectedNode(node)).toBe(true);
  });

  it("returns true for contentControl nodes", () => {
    const node = makeNode("contentControl");
    expect(isProtectedNode(node)).toBe(true);
  });

  it("returns true for field nodes", () => {
    const node = makeNode("field");
    expect(isProtectedNode(node)).toBe(true);
  });

  it("returns true when protectionReason matches", () => {
    const node = makeNode("paragraph", { protectionReason: "custom-lock" });
    expect(isProtectedNode(node, ["custom-lock"])).toBe(true);
  });

  it("returns false for editable paragraph nodes", () => {
    const node = makeNode("paragraph");
    expect(isProtectedNode(node)).toBe(false);
  });

  it("returns false for unprotected nodes with no matching reasons", () => {
    const node = makeNode("paragraph");
    expect(isProtectedNode(node, ["nonexistent"])).toBe(false);
  });
});

describe("isProtectedRange", () => {
  it("returns true when any node in the range is protected", () => {
    const nodes = [makeNode("paragraph"), makeNode("caption")];
    expect(isProtectedRange([nodes[1]!.nodeId], nodes)).toBe(true);
  });

  it("returns false when no nodes are protected", () => {
    const nodes = [makeNode("paragraph"), makeNode("heading")];
    expect(isProtectedRange([nodes[0]!.nodeId], nodes)).toBe(false);
  });

  it("returns false for empty nodeIds", () => {
    const nodes = [makeNode("caption")];
    expect(isProtectedRange([], nodes)).toBe(false);
  });

  it("returns false when nodeId not found", () => {
    const nodes = [makeNode("paragraph")];
    expect(isProtectedRange(["nonexistent"], nodes)).toBe(false);
  });
});
