/**
 * Change-level preconditions (plan P6).
 *
 * The rule these cases pin is unit-scoped, and it is scoped because the unscoped
 * version was self-contradictory: a paragraph-unit `replaceText` was required to
 * carry a `node` precondition *and* a `text` precondition, which is a shape no
 * change can have. Nothing produced one, so the contradiction was invisible until
 * the semantic apply path needed the paragraph unit — the only text write
 * available on every Word host, because `Range.set` is WordApiDesktop 1.4.
 */

import { describe, expect, it } from "vitest";
import {
  matchesChangePrecondition,
  validateChangePreconditions,
} from "../../../src/changes/preconditions";
import type { Change } from "../../../src/core/domain/Change";

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

describe("validateChangePreconditions", () => {
  it("accepts a character-unit replacement guarded by its exact text", () => {
    expect(validateChangePreconditions([change()])).toHaveLength(0);
  });

  it("accepts a paragraph-unit replacement guarded by its node", () => {
    const paragraph = change({
      range: { start: 0, end: 1, unit: "paragraph" },
      precondition: { kind: "node", nodeId: "word-paragraph-p1", expectedText: "hello" },
    });

    expect(validateChangePreconditions([paragraph])).toHaveLength(0);
  });

  it("refuses a paragraph-unit replacement guarded only by text", () => {
    const paragraph = change({ range: { start: 0, end: 1, unit: "paragraph" } });

    expect(validateChangePreconditions([paragraph]).join("; ")).toMatch(
      /paragraph target requires a node precondition/,
    );
  });

  it("still refuses a character-unit replacement with no text precondition", () => {
    // The unit-scoped rule narrows *where* the demand applies, never *whether*.
    const nodeOnly = change({
      precondition: { kind: "node", nodeId: "word-paragraph-p1" },
    });

    expect(validateChangePreconditions([nodeOnly]).join("; ")).toMatch(
      /text mutation requires a text precondition/,
    );
  });

  it("refuses a change with no precondition at all", () => {
    const { precondition: _dropped, ...rest } = change();

    expect(validateChangePreconditions([rest as Change]).join("; ")).toMatch(
      /no verifiable target precondition/,
    );
  });

  it("still requires a text precondition for an insertion", () => {
    const insertion = change({
      type: "insertText",
      precondition: { kind: "node", nodeId: "word-paragraph-p1" },
    });

    expect(validateChangePreconditions([insertion]).join("; ")).toMatch(
      /insertText requires a text precondition/,
    );
  });
});

describe("matchesChangePrecondition, for a paragraph-unit write", () => {
  const paragraph = change({
    range: { start: 0, end: 1, unit: "paragraph" },
    precondition: { kind: "node", nodeId: "word-paragraph-p1", expectedText: "hello" },
  });

  it("matches when the live paragraph still carries that id and text", () => {
    expect(
      matchesChangePrecondition(paragraph, { nodeId: "word-paragraph-p1", text: "hello" }).matches,
    ).toBe(true);
  });

  it("does not match a different paragraph that happens to hold the same text", () => {
    expect(
      matchesChangePrecondition(paragraph, { nodeId: "word-paragraph-p2", text: "hello" }),
    ).toMatchObject({ matches: false, reason: expect.stringContaining("expected node") });
  });

  it("does not match when the paragraph's text moved", () => {
    expect(
      matchesChangePrecondition(paragraph, { nodeId: "word-paragraph-p1", text: "goodbye" }),
    ).toMatchObject({ matches: false, reason: "target node text changed" });
  });
});
