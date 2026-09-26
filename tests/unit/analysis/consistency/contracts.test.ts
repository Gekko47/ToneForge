import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONSISTENCY_ACTIONABLE_CONFIDENCE,
  CONSISTENCY_CHECK_IDS,
  CONSISTENCY_CHECKS,
  CONSISTENCY_CONSENT_ERROR,
  ConsistencyCheckIdSchema,
  consistencyCheck,
  parseConsistencyReviewRequest,
} from "../../../../src/analysis/consistency";

/**
 * The contracts are the engine's safety boundary, so these tests are mostly
 * about what must be impossible rather than what must work.
 */

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    consistencyConsent: true,
    document: { revision: "r1", text: "Some text.", sections: [] },
    ...overrides,
  };
}

describe("consistency check identities", () => {
  it("declares exactly ten checks", () => {
    expect(CONSISTENCY_CHECK_IDS).toHaveLength(10);
  });

  it("numbers them C1 through C10 with no gaps", () => {
    expect(CONSISTENCY_CHECK_IDS).toEqual([
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
      "C6",
      "C7",
      "C8",
      "C9",
      "C10",
    ]);
  });

  it("gives every check a descriptor with a real question", () => {
    CONSISTENCY_CHECK_IDS.forEach((id) => {
      const descriptor = consistencyCheck(id);
      expect(descriptor.id).toBe(id);
      expect(descriptor.title.length).toBeGreaterThan(0);
      // A check with no stated question is a check nobody can review.
      expect(descriptor.question.endsWith("?")).toBe(true);
    });
  });

  it("describes each check distinctly", () => {
    // Two checks asking the same question would be one check with two names.
    const titles = CONSISTENCY_CHECK_IDS.map((id) => consistencyCheck(id).title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("keeps C2 and C6 separate: value conflict is not unit conflict", () => {
    expect(CONSISTENCY_CHECKS.C2.title).not.toBe(CONSISTENCY_CHECKS.C6.title);
    expect(CONSISTENCY_CHECKS.C6.title.toLowerCase()).toContain("unit");
  });

  it("rejects an unknown check id", () => {
    expect(ConsistencyCheckIdSchema.safeParse("C11").success).toBe(false);
    expect(ConsistencyCheckIdSchema.safeParse("c1").success).toBe(false);
  });

  it("states whether each check can be decided deterministically first", () => {
    CONSISTENCY_CHECK_IDS.forEach((id) => {
      expect(typeof consistencyCheck(id).deterministicFirst).toBe("boolean");
    });
  });

  it("keeps a confidence threshold the engine can act on", () => {
    expect(CONSISTENCY_ACTIONABLE_CONFIDENCE).toBeGreaterThan(0);
    expect(CONSISTENCY_ACTIONABLE_CONFIDENCE).toBeLessThanOrEqual(1);
  });
});

describe("the consent gate", () => {
  it("refuses a request with no consent at all", () => {
    expect(() => parseConsistencyReviewRequest({ document: { revision: "r", text: "t" } })).toThrow(
      /own explicit consent/,
    );
  });

  it("refuses a request whose consent is false", () => {
    expect(() => parseConsistencyReviewRequest(request({ consistencyConsent: false }))).toThrow(
      CONSISTENCY_CONSENT_ERROR,
    );
  });

  it("refuses a truthy-but-not-true consent", () => {
    // A caller passing the string "true" has not opted in; treating it as
    // consent would let a mis-typed value send a document.
    expect(() => parseConsistencyReviewRequest(request({ consistencyConsent: "true" }))).toThrow(
      CONSISTENCY_CONSENT_ERROR,
    );
  });

  it("refuses null and undefined consent", () => {
    expect(() => parseConsistencyReviewRequest(request({ consistencyConsent: null }))).toThrow();
    expect(() =>
      parseConsistencyReviewRequest(request({ consistencyConsent: undefined })),
    ).toThrow();
  });

  it("refuses non-object input entirely", () => {
    expect(() => parseConsistencyReviewRequest(null)).toThrow();
    expect(() => parseConsistencyReviewRequest("run it")).toThrow();
  });

  it("does not accept another consent flag in its place", () => {
    // Spot review, full-document review, and semantic opt-in are all separate
    // decisions. None of them implies this one (ADR-0052).
    expect(() =>
      parseConsistencyReviewRequest(
        request({ consistencyConsent: undefined, fullDocumentReviewConsent: true }),
      ),
    ).toThrow(/own explicit consent/);
    expect(() =>
      parseConsistencyReviewRequest(
        request({ consistencyConsent: undefined, spotReviewConsent: true, semanticOptIn: true }),
      ),
    ).toThrow(/own explicit consent/);
  });

  it("accepts a well-formed consented request", () => {
    const parsed = parseConsistencyReviewRequest(request());
    expect(parsed.consistencyConsent).toBe(true);
    expect(parsed.document.revision).toBe("r1");
  });

  it("defaults to running all ten checks", () => {
    expect(parseConsistencyReviewRequest(request()).checks).toEqual([...CONSISTENCY_CHECK_IDS]);
  });

  it("still validates the document when consent is present", () => {
    expect(() =>
      parseConsistencyReviewRequest(request({ document: { revision: "", text: "t" } })),
    ).toThrow();
  });

  it("bounds the statement count so a run cannot be unbounded", () => {
    // The cap is a safety property, not a preference: pairwise comparison is
    // quadratic, so an unbounded run would stall the pane.
    expect(() => parseConsistencyReviewRequest(request({ maxStatements: 10_000 }))).toThrow();
  });
});

describe("the module boundary", () => {
  const engineSource = readFileSync(resolve("src/analysis/consistency/engine.ts"), "utf8");
  const eslintConfig = readFileSync(resolve("eslint.config.mjs"), "utf8");

  it("does not import Word from the engine", () => {
    expect(engineSource).not.toMatch(/from\s+"\.\.\/\.\.\/word\//);
    expect(engineSource).not.toMatch(/Office\./);
  });

  it("does not import the revision adapter from the engine", () => {
    expect(engineSource).not.toMatch(/revisionAdapter/);
  });

  it("declares an eslint scope covering the consistency directory", () => {
    expect(eslintConfig).toContain("src/analysis/consistency/**/*.ts");
  });

  it("documents the ai exception in the eslint config rather than leaving it implicit", () => {
    // The whole point of the exception is that it is deliberate and narrow. An
    // undocumented exception is indistinguishable from a mistake.
    expect(eslintConfig).toMatch(/sanctioned exception/i);
  });

  it("still forbids the consistency engine from reaching word, taskpane, commands, and reformat", () => {
    const scope = eslintConfig.slice(eslintConfig.indexOf("src/analysis/consistency/**/*.ts"));
    const block = scope.slice(0, scope.indexOf("files:"));
    expect(block).toContain("**/word/*");
    expect(block).toContain("**/taskpane/*");
    expect(block).toContain("**/commands/*");
    expect(block).toContain("**/reformat/*");
  });
});
