import { describe, expect, it } from "vitest";
import { resolveAnchor } from "../../../src/analysis/anchorResolution";
import { DocumentNodeSchema } from "../../../src/core/domain/DocumentSnapshot";

/**
 * The refusal cases are the point of this module.
 *
 * An anchor that is wrong, ambiguous, or unaddressable must produce a finding
 * with a stated reason, not a plausible-looking span. Every test below is a way
 * the model can be wrong, and the answer is the same in all of them: do not
 * invent a target.
 */

/** `startOffset: null` produces a node with no `sourceRange` at all. */
function node(
  nodeId: string,
  text: string,
  startOffset: number | null = 0,
): ReturnType<typeof DocumentNodeSchema.parse> {
  return DocumentNodeSchema.parse({
    nodeId,
    type: "paragraph",
    text,
    editable: true,
    includedInGovernance: true,
    sourcePath: `body/${nodeId}`,
    ...(startOffset === null
      ? {}
      : {
          sourceRange: {
            nodeId,
            startOffset,
            endOffset: startOffset + text.length,
          },
        }),
  });
}

describe("resolveAnchor", () => {
  it("resolves a unique quote to a node and an offset within it", () => {
    const result = resolveAnchor("must be reviewed", [node("n1", "Every change must be reviewed first.")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodeId).toBe("n1");
    expect(result.start).toBe(13);
    expect(result.end).toBe(29);
  });

  it("resolves the same quote in whichever node holds it", () => {
    const result = resolveAnchor("see below", [node("n1", "As shown, see below."), node("n2", "Nothing here.")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodeId).toBe("n1");
  });

  it("refuses a quote that is not in the document", () => {
    // A model that paraphrased. Fuzzy-matching would be the wrong answer: it
    // produces a finding pointing at a sentence that says something else.
    const result = resolveAnchor("must be carefully reviewed", [
      node("n1", "Every change must be reviewed first."),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/does not appear in the document/i);
  });

  it("refuses a quote that appears twice in the same node", () => {
    // Two hits in one node are still two candidates, and refusing is the safe
    // answer. Editing the wrong one is a silent corruption.
    const result = resolveAnchor("the data", [node("n1", "the data is stored, and the data is lost")]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/appears 2 times/i);
  });

  it("refuses a quote that appears in two different nodes", () => {
    const result = resolveAnchor("irregardless", [
      node("n1", "We did that irregardless."),
      node("n2", "It happened irregardless of the weather."),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/appears 2 times/i);
  });

  it("refuses an empty anchor", () => {
    const result = resolveAnchor("   ", [node("n1", "Some text here.")]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/did not quote/i);
  });

  it("refuses a quote in a node with no document offset", () => {
    // A node with no source range has no addressable position. Emitting an
    // offset measured from the node's own text start would point into whatever
    // happens to sit there in someone else's document.
    const result = resolveAnchor("findings here", [node("n1", "The findings here matter.", null)]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no document offset/i);
  });

  it("ignores nodes with no text", () => {
    const result = resolveAnchor("quoted", [node("empty", ""), node("n1", "A quoted phrase.")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodeId).toBe("n1");
  });

  it("resolves against an empty document by refusing", () => {
    // What happens when no nodes were acquired at all: every finding stays
    // advisory, which is the correct answer rather than a crash.
    const result = resolveAnchor("anything", []);
    expect(result.ok).toBe(false);
  });

  it("matches case-sensitively rather than guessing", () => {
    const result = resolveAnchor("MUST", [node("n1", "this must not match")]);
    expect(result.ok).toBe(false);
  });
});
