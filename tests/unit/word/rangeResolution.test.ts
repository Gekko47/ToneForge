/**
 * Apply-time target resolution (plan P6, D11's three-step fallback).
 *
 * The rule under test is that a whole paragraph is written through a path every
 * Word host has, and a partial range is only attempted on a host that can do it.
 * Getting that wrong in either direction is visible: prefer the character path
 * unconditionally and Word on the web fails mid-write; refuse a whole paragraph
 * and a capability the user does have stops working.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PARTIAL_SELECTION_REFUSAL,
  resolveWholeParagraphIndex,
  supportsRangedReplacement,
} from "../../../src/word/rangeResolution";
import type { SemanticSelectionAnchor } from "../../../src/core/domain/SemanticReviewSession";
import type { DocumentNode } from "../../../src/core/domain/DocumentSnapshot";
import { hashText } from "../../../src/shared/utils/text";

function anchor(overrides: Partial<SemanticSelectionAnchor> = {}): SemanticSelectionAnchor {
  const selectedText = "The pour completed on 3 March 2026.";
  return {
    documentId: "doc-1",
    nodeIds: ["p-1"],
    startOffset: 0,
    endOffset: selectedText.length,
    selectedText,
    selectionHash: hashText(selectedText),
    capturedAt: "2026-10-01T09:00:00.000Z",
    ...overrides,
  };
}

function paragraphNode(
  paragraphIndex: number,
  startOffset: number,
  endOffset: number,
  uniqueLocalId: string,
): DocumentNode {
  return {
    nodeId: `word-paragraph-${uniqueLocalId}`,
    type: "paragraph",
    text: "x",
    sourcePath: `body/paragraph/${paragraphIndex}`,
    sourceRange: {
      nodeId: `word-paragraph-${uniqueLocalId}`,
      paragraphIndex,
      structuralPath: `body/paragraph/${paragraphIndex}`,
      startOffset,
      endOffset,
    },
    editable: true,
    includedInGovernance: true,
    includedInAIReview: true,
  } as DocumentNode;
}

const SAMPLE = anchor();
const NODES = [
  paragraphNode(0, 0, SAMPLE.endOffset, "p-1"),
  paragraphNode(1, SAMPLE.endOffset, SAMPLE.endOffset + 20, "p-2"),
];

describe("resolveWholeParagraphIndex", () => {
  it("resolves the paragraph whose span is exactly the selection", () => {
    expect(resolveWholeParagraphIndex(SAMPLE, NODES)).toBe(0);
  });

  it("resolves by offsets alone when the host named no paragraph", () => {
    expect(resolveWholeParagraphIndex(anchor({ nodeIds: [] }), NODES)).toBe(0);
  });

  it("refuses a partial selection, because part of a paragraph is not a paragraph", () => {
    expect(resolveWholeParagraphIndex(anchor({ endOffset: 12 }), NODES)).toBeNull();
  });

  it("refuses a multi-paragraph selection", () => {
    expect(
      resolveWholeParagraphIndex(anchor({ endOffset: SAMPLE.endOffset + 20 }), NODES),
    ).toBeNull();
  });

  it("refuses when the named paragraph is not the one at those offsets", () => {
    // The user pointed at paragraph 2 while the offsets still describe paragraph
    // 1. Substituting would write to a paragraph they did not select.
    expect(resolveWholeParagraphIndex(anchor({ nodeIds: ["p-2"] }), NODES)).toBeNull();
  });

  it("refuses when two nodes claim the same span rather than picking one", () => {
    const ambiguous = [paragraphNode(0, 0, SAMPLE.endOffset, "p-1"), ...NODES];

    expect(resolveWholeParagraphIndex(SAMPLE, ambiguous)).toBeNull();
  });

  it("refuses when the snapshot has no paragraph nodes at all", () => {
    expect(resolveWholeParagraphIndex(SAMPLE, [])).toBeNull();
  });
});

describe("supportsRangedReplacement", () => {
  const originalOffice = (globalThis as { Office?: unknown }).Office;

  beforeEach(() => {
    installOffice(withRangeSet(true));
  });

  afterEach(() => {
    (globalThis as { Office?: unknown }).Office = originalOffice;
    vi.restoreAllMocks();
  });

  it("reports true for a host whose range can be narrowed", async () => {
    await expect(supportsRangedReplacement()).resolves.toBe(true);
  });

  it("reports false for a host without Range.set, which is Word on the web", async () => {
    installOffice(withRangeSet(false));

    await expect(supportsRangedReplacement()).resolves.toBe(false);
  });

  it("reports false rather than throwing when Word is unreachable", async () => {
    delete (globalThis as { Office?: unknown }).Office;

    await expect(supportsRangedReplacement()).resolves.toBe(false);
  });

  it("names a remedy the user can act on, because selecting a whole paragraph works everywhere", () => {
    expect(PARTIAL_SELECTION_REFUSAL).toMatch(/whole paragraph/i);
    expect(PARTIAL_SELECTION_REFUSAL).toMatch(/nothing has been changed/i);
  });
});

function withRangeSet(present: boolean): unknown {
  const selection: Record<string, unknown> = { text: "", load: vi.fn() };
  if (present) {
    selection["set"] = vi.fn(function (this: unknown) {
      return this;
    });
  }
  return {
    run: <T>(func: (context: unknown) => Promise<T>): Promise<T> =>
      func({
        document: {
          getSelection: () => selection,
          body: { text: "", load: vi.fn() },
        },
        host: { name: "Word", version: "16.0" },
        sync: vi.fn(),
      }),
  };
}

function installOffice(office: unknown): void {
  (globalThis as { Office?: unknown }).Office = office;
}
