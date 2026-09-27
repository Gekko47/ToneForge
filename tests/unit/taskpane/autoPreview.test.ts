import { describe, expect, it } from "vitest";
import { decidePreview, isFullScan } from "../../../src/taskpane/autoPreview";

/**
 * Auto-preview replaces a button, so its decision is the whole feature.
 *
 * The dangerous case is not previewing too little — it is previewing a
 * document that was never read. A narrowed scan yields findings for three
 * paragraphs; a plan built from it would be presented as though it described
 * the whole document, and the refusal would only surface at Apply, after the
 * user had spent their attention reviewing it.
 */

function input(overrides: Partial<Parameters<typeof decidePreview>[0]> = {}) {
  return {
    fullScan: true,
    docHash: "hash-1",
    previewedDocHash: null,
    previewing: false,
    ...overrides,
  };
}

describe("decidePreview", () => {
  it("previews a full scan that has never been previewed", () => {
    expect(decidePreview(input())).toEqual({ kind: "preview", docHash: "hash-1" });
  });

  it("refuses a narrowed scan and says what to do instead", () => {
    const decision = decidePreview(input({ fullScan: false }));
    expect(decision.kind).toBe("skip");
    // The reason is user-facing: it has to name the action, not the rule.
    expect(decision.kind === "skip" && decision.reason).toMatch(/Re-scan/);
  });

  it("refuses to preview a second time for the same document", () => {
    // Without this, a re-render or a repeated status emission would rebuild the
    // plan on every pass and the user's reviewed plan would change underneath.
    expect(decidePreview(input({ previewedDocHash: "hash-1" })).kind).toBe("skip");
  });

  it("previews again once the document has changed", () => {
    expect(decidePreview(input({ previewedDocHash: "hash-0" }))).toEqual({
      kind: "preview",
      docHash: "hash-1",
    });
  });

  it("does not start a second preview while one is running", () => {
    // Two concurrent previews would race to set the same state, and the loser
    // would silently replace a plan the user had already begun reviewing.
    expect(decidePreview(input({ previewing: true })).kind).toBe("skip");
  });

  it("refuses before any scan has completed", () => {
    expect(decidePreview(input({ docHash: null })).kind).toBe("skip");
  });

  it("treats a narrowed scan as narrowed even when a preview exists", () => {
    // Order matters: the narrowed check is the safety property, so it must not
    // be short-circuited into "already previewed" by an unrelated condition.
    const decision = decidePreview(input({ fullScan: false, previewedDocHash: "hash-0" }));
    expect(decision.kind).toBe("skip");
  });
});

describe("isFullScan", () => {
  it("recognises a report that says it examined part of the document", () => {
    expect(isFullScan({ acquisition: { incremental: true } })).toBe(false);
  });

  it("recognises a whole-document report", () => {
    expect(isFullScan({ acquisition: { incremental: false } })).toBe(true);
  });

  it("treats a report with no scope claim as a full scan", () => {
    // A scan that cannot state its scope has not said it was narrow. Refusing
    // to preview on a technicality would reinstate the button.
    expect(isFullScan({})).toBe(true);
    expect(isFullScan(null)).toBe(true);
  });
});
