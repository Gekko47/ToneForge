/**
 * Qualifier and negation extraction.
 *
 * The behaviour under test is calibration, not parsing. The lists come from the
 * specification's §17 verbatim, and the risk they carry is not that the matcher
 * misses a word — it is that it fires so often that the product stops being
 * believed. So the tests below are mostly about *not* matching.
 */

import { describe, expect, it } from "vitest";

import {
  countTerm,
  extractQualifiers,
  NEGATION_TERMS,
  qualifierMessage,
  QUALIFIER_TERMS,
} from "../../../../src/analysis/semantic/qualifiers";

describe("extractQualifiers", () => {
  it("matches a multi-word qualifier as one term, not as its words", () => {
    // Split into words, this would report `opinion` removed when the author
    // still says it, which is a warning about nothing.
    const found = extractQualifiers("the sum is recoverable in my opinion");
    expect(found.map((entry) => entry.term)).toEqual(["in my opinion"]);
  });

  it("matches a word boundary rather than a substring", () => {
    // `if` must not match inside `if-` or a longer identifier, and `no` must not
    // match inside `notice`.
    expect(extractQualifiers("notify the officer if-x").map((entry) => entry.term)).not.toContain(
      "if",
    );
    expect(extractQualifiers("a notice was served").map((entry) => entry.term)).not.toContain("no");
  });

  it("keeps a longer term inside a longer one", () => {
    // `cannot` is matched whole; reporting the `not` inside it as a separate
    // negation would double-count one change.
    const found = extractQualifiers("the Contractor cannot determine this");
    expect(found.filter((entry) => entry.term === "cannot")).toHaveLength(1);
    expect(found.filter((entry) => entry.term === "not")).toHaveLength(0);
  });

  it("counts occurrences rather than positions, so a repeated hedge is one finding", () => {
    const found = extractQualifiers("it may be recoverable and it may be measurable");
    expect(found.filter((entry) => entry.term === "may")).toHaveLength(2);
  });

  it("separates the two classes", () => {
    expect(extractQualifiers("it is unlikely").map((entry) => entry.kind)).toEqual(["qualifier"]);
    expect(extractQualifiers("it is not recoverable").map((entry) => entry.kind)).toEqual([
      "negation",
    ]);
  });

  it("returns nothing for text with no hedge in it", () => {
    expect(extractQualifiers("The delay was caused by late design information.")).toEqual([]);
  });

  it("reports positions that index back into the source text", () => {
    const text = "the sum is recoverable in my opinion";
    const [found] = extractQualifiers(text);
    expect(text.slice(found?.start, found?.end)).toBe("in my opinion");
  });

  it("is deterministic", () => {
    const text = "it may be recoverable in my opinion and it is not final";
    expect(extractQualifiers(text)).toEqual(extractQualifiers(text));
  });
});

describe("countTerm", () => {
  it("counts case-insensitively and refuses substrings", () => {
    expect(countTerm("It May be so", "may")).toBe(1);
    expect(countTerm("a notice", "no")).toBe(0);
  });

  it("counts a phrase whole", () => {
    expect(countTerm("in my opinion, and again in my opinion", "in my opinion")).toBe(2);
  });
});

describe("qualifierMessage", () => {
  it("names the term and what happened to it", () => {
    expect(qualifierMessage("only", "negation", "removed")).toContain("only");
    expect(qualifierMessage("only", "negation", "removed")).toContain("removed");
    expect(qualifierMessage("may", "qualifier", "added")).toContain("added");
  });
});

describe("the vocabularies", () => {
  it("carries every term the specification's §17 lists", () => {
    // The list is quoted rather than restated: a validator whose vocabulary has
    // silently shrunk reports "no change" for a hedge it no longer looks for.
    const listed = [
      "may",
      "might",
      "could",
      "appears",
      "approximately",
      "in my opinion",
      "on balance",
      "subject to",
      "assuming",
      "if",
      "to the extent",
      "not",
      "no",
      "only",
      "all",
    ];
    listed.forEach((term) => {
      expect([...QUALIFIER_TERMS, ...NEGATION_TERMS]).toContain(term);
    });
  });

  it("lists no term twice across the two vocabularies", () => {
    const all = [...QUALIFIER_TERMS, ...NEGATION_TERMS];
    expect(all).toHaveLength(new Set(all).size);
  });
});
