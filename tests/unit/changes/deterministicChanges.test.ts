/**
 * Spec §27 gate 5: every auto-correctable field is wired to a safe Change.
 *
 * The two sides of that claim live in different files — `ruleRegistry.ts`
 * declares what a rule can correct, and `deterministicChanges.ts` builds the
 * correction — and nothing in the type system connects them. This file is what
 * connects them, and it fails in both directions:
 *
 * - a category a `correctable: true` rule declares but the planner cannot build
 *   is a rule advertising "Approve" for something Apply silently drops;
 * - a category the planner can build that no rule emits is a case no finding
 *   can ever reach, which is dead code that will rot without complaining;
 * - a category declared correctable that is also listed as reported-only is a
 *   contradiction, and the user meets it as a button that does nothing.
 *
 * These are the assertions that would have caught the second change planner
 * while it still existed.
 */

import { describe, expect, it } from "vitest";
import {
  allRules,
  DETERMINISTIC_RULES,
  PROFILE_FIELD_PATHS,
  ruleByCategory,
  unwiredProfilePaths,
} from "../../../src/analysis/deterministic/ruleRegistry";
import {
  DETERMINISTIC_CORRECTABLE_CATEGORIES,
  DETERMINISTIC_REPORTED_ONLY_CATEGORIES,
  planDeterministicChange,
} from "../../../src/changes/deterministicChanges";
import type { Finding } from "../../../src/core/domain/Finding";

/** Every category a rule says it can emit. */
function emittedCategories(): readonly string[] {
  return allRules().flatMap((rule) => rule.emits ?? [rule.category]);
}

describe("registry and planner agree about what can be corrected", () => {
  /*
   * A correctable rule may mix: `typography/numbers` corrects a decimal
   * separator and declines to spell out a numeral, and the per-finding
   * `correctionAvailable` is what distinguishes them. What it may not do is
   * declare a category neither side accounts for — that is a finding with no
   * plan and no stated reason for having none.
   */
  it("gives every category a correctable rule declares a plan or a stated refusal", () => {
    const unaccounted = allRules()
      .filter((rule) => rule.correctable)
      .flatMap((rule) => rule.emits ?? [rule.category])
      .filter(
        (category) =>
          !DETERMINISTIC_CORRECTABLE_CATEGORIES.has(category) &&
          !DETERMINISTIC_REPORTED_ONLY_CATEGORIES.has(category),
      );

    expect([...new Set(unaccounted)]).toEqual([]);
  });

  it("builds a change for no category that no rule emits", () => {
    const orphans = [...DETERMINISTIC_CORRECTABLE_CATEGORIES].filter(
      (category) => !emittedCategories().includes(category),
    );

    expect(orphans).toEqual([]);
  });

  it("never declares a category both correctable and reported-only", () => {
    const contradictions = [...DETERMINISTIC_CORRECTABLE_CATEGORIES].filter((category) =>
      DETERMINISTIC_REPORTED_ONLY_CATEGORIES.has(category),
    );

    expect(contradictions).toEqual([]);
  });

  it("makes every category a report-only rule declares report-only", () => {
    /*
     * A rule the review reads as "reported, not correctable" must not also
     * declare a category the planner would turn into a change. The two answers
     * reach the user as two different buttons, and only one of them is right.
     */
    const contradicts = allRules()
      .filter((rule) => !rule.correctable)
      .flatMap((rule) => rule.emits ?? [rule.category])
      .filter((category) => DETERMINISTIC_CORRECTABLE_CATEGORIES.has(category));

    expect(contradicts).toEqual([]);
  });

  it("lists every reported-only category as something the planner knows about", () => {
    const unknown = [...DETERMINISTIC_REPORTED_ONLY_CATEGORIES].filter(
      (category) =>
        ruleByCategory(category) === undefined && !emittedCategories().includes(category),
    );

    expect(unknown).toEqual([]);
  });

  it("puts every category a non-correctable rule emits in the reported-only set", () => {
    /*
     * The partition must be exact: a `correctable: false` rule that emits a
     * category absent from `DETERMINISTIC_REPORTED_ONLY_CATEGORIES` is a finding
     * the planner has no answer for — neither a change nor a stated refusal.
     */
    const missing = allRules()
      .filter((rule) => !rule.correctable)
      .flatMap((rule) => rule.emits ?? [rule.category])
      .filter((category) => !DETERMINISTIC_REPORTED_ONLY_CATEGORIES.has(category));

    expect(missing).toEqual([]);
  });
});

describe("planDeterministicChange", () => {
  const base: Omit<Finding, "category"> = {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "deterministic",
    range: { start: 0, end: 1, unit: "character" },
    message: "a finding",
    severity: "warning",
    evidence: "old",
    confidence: 1,
    nodeIds: [],
    source: "deterministic",
    risk: "none",
    reversible: true,
    status: "new",
  };

  it("plans nothing for a category outside the deterministic set", () => {
    const finding: Finding = { ...base, category: "consistency.contradiction" };
    expect(planDeterministicChange(finding)).toEqual([]);
  });

  it("plans nothing when the rule declined to correct the finding", () => {
    const finding: Finding = {
      ...base,
      category: "formatting.bodyStyle",
      expected: "Normal",
      deterministic: {
        profilePath: "formatting.bodyStyle.styleName",
        correctionAvailable: false,
        correctionReason: "Reviewed by hand.",
      },
    };
    expect(planDeterministicChange(finding)).toEqual([]);
  });

  it("plans nothing for an ignored or deferred finding", () => {
    ["ignored", "deferred"].forEach((status) => {
      const finding: Finding = { ...base, category: "typography.emDash", status } as Finding;
      expect(planDeterministicChange(finding)).toEqual([]);
    });
  });

  it("plans nothing for a finding marked not actionable", () => {
    const finding: Finding = {
      ...base,
      category: "typography.emDash",
      actionable: false,
    };
    expect(planDeterministicChange(finding)).toEqual([]);
  });

  it("produces a change carrying the finding, the rule and an exact precondition", () => {
    const finding: Finding = {
      ...base,
      category: "typography.emDash",
      ruleId: "typography.dashes",
      message: "Use em dash (—) instead of double hyphen (--)",
      actual: "--",
    };
    const changes = planDeterministicChange(finding);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      type: "replaceText",
      payload: { text: "—" },
      findingId: finding.id,
      ruleId: "typography.dashes",
      precondition: { kind: "text", expectedText: "--" },
    });
  });

  it("plans an empty deletion for a trailing-space finding", () => {
    const finding: Finding = {
      ...base,
      category: "typography.whitespace",
      message: "Remove trailing spaces",
      actual: " ",
    };
    expect(planDeterministicChange(finding)[0]).toMatchObject({
      type: "deleteRange",
      payload: {},
    });
  });

  it("plans a non-reversible deletion for a banned term", () => {
    const finding: Finding = {
      ...base,
      category: "language.bannedTerm",
      range: { start: 3, end: 9, unit: "character" },
      actual: "banned",
    };
    expect(planDeterministicChange(finding)[0]).toMatchObject({
      type: "deleteRange",
      reversible: false,
    });
  });
});

describe("the registry audit itself", () => {
  it("leaves no profile field unwired and unexcused", () => {
    expect(unwiredProfilePaths()).toEqual([]);
  });

  it("gives every rule a unique id", () => {
    const ids = allRules().map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares a profile path for every field the profile exposes", () => {
    PROFILE_FIELD_PATHS.forEach((path) => {
      expect(typeof path).toBe("string");
    });
    expect(DETERMINISTIC_RULES.length).toBeGreaterThan(0);
  });
});
