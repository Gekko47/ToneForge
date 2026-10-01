/**
 * The preservation validator, driven by the P0 corpus.
 *
 * Every case in `tests/fixtures/expertProse.ts` is a single-variable
 * experiment: one span of the base paragraph replaced, so a report naming two
 * differences is failing the fixture's own premise. The control case is the
 * other half of the contract — a faithful restyle must come back clean, because
 * a validator that objects to a legitimate rewrite is one users stop reading.
 */

import { describe, expect, it } from "vitest";

import { validatePreservation } from "../../../../src/analysis/semantic/preservationValidator";
import {
  CLEAN_RESTYLE_CASE,
  PRESERVATION_BASE_PARAGRAPH,
  PROTECTED_FACT_PRESERVATION_CASES,
  QUALIFIER_PRESERVATION_CASES,
} from "../../../fixtures/expertProse";

const BASE = PRESERVATION_BASE_PARAGRAPH;

describe("validatePreservation — the hard tier", () => {
  PROTECTED_FACT_PRESERVATION_CASES.forEach((testCase) => {
    it(`refuses ${testCase.id}`, () => {
      const report = validatePreservation(testCase.original, testCase.proposed);

      expect(report.pass).toBe(false);
      expect(report.summary).toMatch(/cannot be applied as a style-only revision/i);

      const mentioned = [
        ...report.missing.map((fact) => fact.surface),
        ...report.added.map((fact) => fact.surface),
        ...report.changed.flatMap((change) => [change.from.surface, change.to.surface]),
      ];
      if (testCase.expected.value !== undefined) {
        expect(mentioned).toContain(testCase.expected.value);
      }
      if (testCase.expected.replacement !== undefined) {
        expect(mentioned).toContain(testCase.expected.replacement);
      }

      // Every message names the token, so the user is told what to look at
      // rather than being told that something changed.
      report.warnings
        .filter((warning) => warning.tier === "hard")
        .forEach((warning) => {
          expect(warning.message).toContain(warning.surface);
        });
    });
  });

  it("names a changed value on both sides rather than only reporting a removal", () => {
    const report = validatePreservation(BASE, BASE.replace("30 June 2025", "18 July 2025"));
    expect(report.changed).toHaveLength(1);
    expect(report.changed[0]?.from.surface).toBe("30 June 2025");
    expect(report.changed[0]?.to.surface).toBe("18 July 2025");
    expect(report.changed[0]?.message).toContain("30 June 2025");
    expect(report.changed[0]?.message).toContain("18 July 2025");
  });

  it("reports a dropped figure as missing rather than inventing a replacement", () => {
    const report = validatePreservation(
      BASE,
      BASE.replace("The prolongation cost of £1,240,000, ", ""),
    );
    expect(report.pass).toBe(false);
    expect(report.missing.map((fact) => fact.surface)).toContain("£1,240,000");
    // One figure became none: there is no pairing to report, and inventing one
    // would be a guess presented as a finding.
    expect(report.changed).toHaveLength(0);
  });

  it("does not report a difference for a reformatting of the same figure", () => {
    const report = validatePreservation(BASE, BASE.replace("£1,240,000", "£1240000"));
    expect(report.pass).toBe(true);
  });

  it("reports exactly one difference for a paragraph that contains one", () => {
    const report = validatePreservation(BASE, BASE.replace("42 days", "24 days"));
    expect(report.warnings.filter((warning) => warning.tier === "hard")).toHaveLength(1);
  });
});

describe("validatePreservation — the soft tier", () => {
  QUALIFIER_PRESERVATION_CASES.forEach((testCase) => {
    it(`warns without refusing on ${testCase.id}`, () => {
      const report = validatePreservation(testCase.original, testCase.proposed);

      // The point of the tier split: these changes are real and the product says
      // so, but a hard block here would fire on most legitimate restyles.
      expect(report.pass).toBe(true);
      expect(report.requiresAcknowledgement).toBe(true);
      expect(report.warnings.length).toBeGreaterThan(0);
      expect(report.warnings.every((warning) => warning.tier === "soft")).toBe(true);

      if (testCase.expected.value !== undefined) {
        expect(report.warnings.map((warning) => warning.term)).toContain(testCase.expected.value);
      }
    });
  });

  it("distinguishes a qualifier from a negation in the message", () => {
    const added = validatePreservation(
      BASE,
      BASE.replace("is recoverable in my opinion", "is not recoverable in my opinion"),
    );
    expect(added.warnings.map((warning) => warning.kind)).toContain("negation");

    const removed = validatePreservation(
      BASE,
      BASE.replace("is recoverable in my opinion", "is recoverable"),
    );
    expect(removed.warnings.map((warning) => warning.direction)).toContain("removed");
  });

  it("never refuses on a bare number it cannot classify", () => {
    // `3` might be a count, an item number, or a house number. Blocking on it
    // would refuse revisions that change nothing at all.
    const report = validatePreservation(
      "Clause 12 was applied to 7 items.",
      "Clause 12 was applied to 9 items.",
    );
    expect(report.pass).toBe(true);
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it("warns rather than refuses when an entity name cannot be classified", () => {
    // Both sides are unclassifiable: neither ends in an organisational suffix,
    // so the extractor cannot say what either is, and it says so rather than
    // refusing. This is the calibration the soft tier exists to express.
    const report = validatePreservation(
      "The berth was used by Halvorsen Quay throughout the period.",
      "The berth was used by Halvorsen Docks throughout the period.",
    );
    expect(report.pass).toBe(true);
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it("refuses when a name becomes a recognised party, because a party was added", () => {
    // The same pair read the other way: `Limited` makes the proposal side a
    // party, so something that was not there now is. Refusing is correct, and
    // the message says which token.
    const report = validatePreservation(
      "The berth was used by Halvorsen Quay throughout the period.",
      "The berth was used by Halvorsen Quay Limited throughout the period.",
    );
    expect(report.pass).toBe(false);
    expect(report.warnings.map((warning) => warning.surface)).toContain("Halvorsen Quay Limited");
  });
});

describe("validatePreservation — the control", () => {
  it("passes a faithful restyle with nothing to acknowledge", () => {
    const report = validatePreservation(CLEAN_RESTYLE_CASE.original, CLEAN_RESTYLE_CASE.proposed);

    // No warning at all. A validator that objects here is refusing the product's
    // actual purpose, and every warning it raises on a legitimate rewrite costs
    // it credibility on the ones that matter.
    expect(report.warnings).toEqual([]);
    expect(report.missing).toEqual([]);
    expect(report.added).toEqual([]);
    expect(report.changed).toEqual([]);
    expect(report.pass).toBe(true);
    expect(report.requiresAcknowledgement).toBe(false);
    expect(report.summary).toBe("");
  });

  it("passes identical text", () => {
    const report = validatePreservation(BASE, BASE);
    expect(report.pass).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it("does not throw on empty input, because a validator that fails open is the failure", () => {
    expect(() => validatePreservation("", "")).not.toThrow();
    expect(validatePreservation("", "").pass).toBe(true);
    expect(validatePreservation(BASE, "").pass).toBe(false);
  });

  it("is deterministic", () => {
    const proposed = BASE.replace("30 June 2025", "18 July 2025");
    expect(validatePreservation(BASE, proposed)).toEqual(validatePreservation(BASE, proposed));
  });
});
