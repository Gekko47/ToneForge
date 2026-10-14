/**
 * Pure overlap assessment between a proposed change and tracked revisions.
 *
 * The rules pinned here are the conservative ones the spec asks for: a change
 * that lands on someone else's unaccepted revision is refused, a change that
 * lands on ToneForge's own revision is recognised as already applied, and a
 * change whose overlap cannot be determined is refused rather than guessed.
 */

import { describe, expect, it } from "vitest";
import { assessRevisionOverlap } from "../../../src/changes/revisionOverlap";
import type { Change } from "../../../src/core/domain/Change";
import type { TrackedRevision } from "../../../src/core/domain/TrackedRevision";
import {
  ALL_REVISIONS,
  FOREIGN_REVISION,
  TONE_FORGE_REVISION,
  UNRESOLVED_REVISION,
} from "../../fixtures/trackedRevisions";

function change(overrides: Partial<Change> = {}): Change {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    type: "replaceText",
    range: { start: 0, end: 5, unit: "character" },
    payload: { text: "hello" },
    precondition: { kind: "text", expectedText: "hello" },
    ...overrides,
  } as Change;
}

function revision(overrides: Partial<TrackedRevision> = {}): TrackedRevision {
  return { ...FOREIGN_REVISION, ...overrides };
}

describe("assessRevisionOverlap", () => {
  it("returns none when no revision overlaps the change target", () => {
    const result = assessRevisionOverlap(
      change({
        range: {
          start: 100,
          end: 105,
          unit: "character",
          target: { kind: "paragraph", index: 99, nodeId: "p99" },
        },
      }),
      ALL_REVISIONS,
    );

    expect(result.kind).toBe("none");
  });

  it("returns own when the overlapping revision is authored by ToneForge", () => {
    const result = assessRevisionOverlap(change({ range: { start: 10, end: 24 } }), ALL_REVISIONS);

    expect(result.kind).toBe("own");
    if (result.kind === "own") {
      expect(result.revision.author).toBe("ToneForge");
    }
  });

  it("returns foreign when the overlapping revision is authored by another user", () => {
    const result = assessRevisionOverlap(change({ range: { start: 30, end: 41 } }), ALL_REVISIONS);

    expect(result.kind).toBe("foreign");
    if (result.kind === "foreign") {
      expect(result.revision.author).toBe("Alice");
    }
  });

  it("returns none when a revision has no offsets but node identities are known and differ", () => {
    const result = assessRevisionOverlap(
      change({
        range: {
          start: 0,
          end: 5,
          unit: "character",
          target: { kind: "paragraph", index: 0, nodeId: "p1" },
        },
      }),
      [UNRESOLVED_REVISION],
    );

    expect(result.kind).toBe("none");
  });

  it("returns unknown when a revision has no target and offsets are unavailable", () => {
    const noTarget: TrackedRevision = {
      index: 3,
      type: "Added",
      author: "Bob",
      date: null,
      text: "bob's edit",
      range: null,
      target: undefined,
    };
    const result = assessRevisionOverlap(
      change({
        range: {
          start: 0,
          end: 5,
          unit: "character",
          target: { kind: "paragraph", index: 0, nodeId: "p1" },
        },
      }),
      [noTarget],
    );

    expect(result.kind).toBe("unknown");
    if (result.kind === "unknown") {
      expect(result.reason).toMatch(/offsets are unavailable/);
    }
  });

  it("treats adjacent ranges as non-overlapping (half-open boundary)", () => {
    // TONE_FORGE_REVISION covers [10, 24). A change at [24, 30) starts exactly
    // where it ends — adjacent, not overlapping.
    const result = assessRevisionOverlap(change({ range: { start: 24, end: 30 } }), [
      TONE_FORGE_REVISION,
    ]);

    expect(result.kind).toBe("none");
  });

  it("treats a zero-width insertion as overlapping the range that contains it", () => {
    const result = assessRevisionOverlap(change({ range: { start: 15, end: 15 } }), [
      TONE_FORGE_REVISION,
    ]);

    expect(result.kind).toBe("own");
  });

  it("resolves identical phrases in different paragraphs by node identity, not text", () => {
    // Two revisions carry the same text but live in different paragraphs. A
    // change on the second paragraph must not be refused because the first
    // paragraph happens to contain the same phrase.
    const first = revision({
      range: { start: 10, end: 20 },
      target: { kind: "paragraph", index: 0, nodeId: "p1" },
    });
    const second = revision({
      range: { start: 50, end: 60 },
      target: { kind: "paragraph", index: 1, nodeId: "p2" },
    });

    const result = assessRevisionOverlap(
      change({
        range: {
          start: 50,
          end: 60,
          unit: "character",
          target: { kind: "paragraph", index: 1, nodeId: "p2" },
        },
      }),
      [first, second],
    );

    expect(result.kind).toBe("foreign");
    if (result.kind === "foreign") {
      expect(result.revision.target?.kind === "paragraph" && result.revision.target.nodeId).toBe(
        "p2",
      );
    }
  });

  it("returns none for an empty revision list", () => {
    expect(assessRevisionOverlap(change(), []).kind).toBe("none");
  });

  it("classifies a ToneForge deletion as own", () => {
    const deleted: TrackedRevision = {
      index: 0,
      type: "Deleted",
      author: "ToneForge",
      date: "2026-10-13T10:00:00Z",
      text: "removed",
      range: { start: 10, end: 17 },
    };

    const result = assessRevisionOverlap(change({ range: { start: 10, end: 17 } }), [deleted]);

    expect(result.kind).toBe("own");
  });
});
