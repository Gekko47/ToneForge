import { describe, expect, it } from "vitest";
import {
  REWRITE_CONSENT_ERROR,
  RewriteResponseSchema,
  buildRewritePrompt,
} from "../../../../src/ai/prompts/rewritePrompts";

const SEMANTIC = {
  tone: "neutral",
  voice: "third-person",
  formality: 50,
  vocabularyRegister: "standard",
  rhetoricalStyle: "direct",
};

const SELECTION = "Onboarding is manual and takes about two weeks to complete.";

describe("buildRewritePrompt", () => {
  it("throws when includeRawText is explicitly false", () => {
    expect(() => buildRewritePrompt(SEMANTIC, SELECTION, { includeRawText: false })).toThrow(
      REWRITE_CONSENT_ERROR,
    );
  });

  it("throws by default, so a caller who forgets the flag fails loudly", () => {
    /*
     * The default is false and the builder throws rather than degrading to a
     * text-free prompt. A caller who forgets the flag must not get a plausible
     * request that quietly omits the document.
     */
    expect(() => buildRewritePrompt(SEMANTIC, SELECTION)).toThrow(/includeRawText: true/);
  });

  it("includes the selection when the gate is open", () => {
    const prompt = buildRewritePrompt(SEMANTIC, SELECTION, { includeRawText: true });
    expect(prompt).toContain(SELECTION);
  });

  it("includes the semantic style as JSON so the model reads the same values", () => {
    const prompt = buildRewritePrompt(SEMANTIC, SELECTION, { includeRawText: true });
    expect(prompt).toContain(JSON.stringify(SEMANTIC));
  });

  it("demands the four keys the response schema requires", () => {
    const prompt = buildRewritePrompt(SEMANTIC, SELECTION, { includeRawText: true });
    ["rewritten", "anchor", "rationale", "confidence"].forEach((key) => {
      expect(prompt).toContain(key);
    });
  });

  it("requires the anchor to be the whole selection, copied exactly", () => {
    /*
     * A paraphrased anchor has no exact span to match, and a partial anchor
     * leaves the replacement describing more text than the change would touch.
     * Saying so at the point the model can still see the text is the only place
     * the instruction works.
     */
    const prompt = buildRewritePrompt(SEMANTIC, SELECTION, { includeRawText: true });
    expect(prompt).toMatch(/character for character/i);
    expect(prompt).toMatch(/entire text below/i);
    expect(prompt).toMatch(/partial anchor is refused/i);
  });

  it("forbids a content edit as well as a style change", () => {
    const prompt = buildRewritePrompt(SEMANTIC, SELECTION, { includeRawText: true });
    expect(prompt).toMatch(/not a content edit/i);
    expect(prompt).toMatch(/preserve the author's claims, names, figures, and\s+intent/i);
  });

  it("refuses an empty selection rather than prompting on nothing", () => {
    expect(() => buildRewritePrompt(SEMANTIC, "   ", { includeRawText: true })).toThrow(
      /nothing to rewrite/i,
    );
  });
});

describe("RewriteResponseSchema", () => {
  const valid = {
    rewritten: "Onboarding is manual and takes roughly two weeks.",
    anchor: "about two weeks",
    rationale: "Replaces one word without changing the claim.",
    confidence: 0.82,
  };

  it("accepts a well-formed rewrite", () => {
    expect(RewriteResponseSchema.parse(valid)).toMatchObject({ confidence: 0.82 });
  });

  it("strips unknown fields", () => {
    const parsed = RewriteResponseSchema.parse({ ...valid, modelNotes: "ignore" });
    expect(parsed).not.toHaveProperty("modelNotes");
  });

  it("rejects a rewrite with no anchor, which would have no precondition", () => {
    expect(RewriteResponseSchema.safeParse({ ...valid, anchor: "" }).success).toBe(false);
  });

  it("rejects a rewrite with no rationale", () => {
    expect(RewriteResponseSchema.safeParse({ ...valid, rationale: "  " }).success).toBe(false);
  });

  it("rejects a confidence outside 0-1", () => {
    expect(RewriteResponseSchema.safeParse({ ...valid, confidence: 1.4 }).success).toBe(false);
    expect(RewriteResponseSchema.safeParse({ ...valid, confidence: -0.1 }).success).toBe(false);
  });
});
