/**
 * Bulk terminology creation — the pure logic behind the paste.
 *
 * Tested directly rather than through the component, because every decision here
 * is a function of its arguments. The component test in
 * `terminologyBulkAdd.test.tsx` covers only what the DOM adds: the summary text
 * and the disabled state.
 */

import { describe, expect, it } from "vitest";

import {
  buildBulkRules,
  newTerminologyRule,
  nextTermId,
  nextTermIds,
  planBulkTerms,
  NEW_RULE_SEVERITY,
} from "../../../src/taskpane/terminologyRows";
import type { TerminologyRule } from "../../../src/core/domain/StyleProfile";

function rule(overrides: Partial<TerminologyRule> & { id: string }): TerminologyRule {
  return {
    source: "term",
    replacement: "term",
    caseSensitive: false,
    wholeWord: true,
    severity: "advisory",
    scope: {},
    ...overrides,
  };
}

describe("newTerminologyRule", () => {
  it("uses the same defaults the single-add button has always used", () => {
    // The third argument matters: the button creates a placeholder row whose
    // replacement equals its term, so a rule with no replacement at all is a
    // different thing and is covered separately below.
    expect(newTerminologyRule("term-1", "colour", "colour")).toEqual({
      id: "term-1",
      source: "colour",
      replacement: "colour",
      caseSensitive: false,
      wholeWord: true,
      severity: NEW_RULE_SEVERITY,
      scope: {},
    });
  });

  it("omits the replacement rather than setting it empty when there is none", () => {
    /*
     * Not cosmetic. The schema treats an absent replacement and an empty one
     * differently — "term has no replacement" and "term replaces with nothing"
     * are two rules, and collapsing them would silently change what a finding
     * reports.
     */
    expect("replacement" in newTerminologyRule("term-1", "colour")).toBe(false);
    expect("replacement" in newTerminologyRule("term-1", "colour", "")).toBe(false);
  });

  it("keeps a replacement that was supplied", () => {
    expect(newTerminologyRule("term-1", "colour", "color").replacement).toBe("color");
  });
});

describe("nextTermIds", () => {
  it("fills gaps in an existing sequence rather than skipping past them", () => {
    // term-2 free, so it is term-2 — not a fresh term-4 that renumbers nothing
    // but leaves the user hunting for where their rows went.
    expect(nextTermId([rule({ id: "term-1" }), rule({ id: "term-3" })])).toBe("term-2");
  });

  it("returns as many distinct ids as asked for", () => {
    const ids = nextTermIds([rule({ id: "term-1" })], 3);
    expect(ids).toEqual(["term-2", "term-3", "term-4"]);
    expect(new Set(ids).size).toBe(3);
  });

  it("never hands back an id an existing rule already holds", () => {
    const existing = [rule({ id: "term-1" }), rule({ id: "term-2" }), rule({ id: "term-4" })];
    expect(nextTermIds(existing, 4)).toEqual(["term-3", "term-5", "term-6", "term-7"]);
  });

  it("returns nothing when nothing was asked for", () => {
    expect(nextTermIds([], 0)).toEqual([]);
  });
});

describe("planBulkTerms", () => {
  it("adds every pair in a paste against an empty list", () => {
    const plan = planBulkTerms({ colour: "color", prioritise: "prioritize" }, []);
    expect(plan.added.map((entry) => entry.source)).toEqual(["colour", "prioritise"]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips a term the list already has, rather than overwriting it", () => {
    /*
     * The whole point of additive-only. A user pasting twenty lines who has
     * already tuned three of them must not lose those three settings to a
     * default the paste carries.
     */
    const existing = [rule({ id: "term-1", source: "colour", replacement: "COLOUR" })];
    const plan = planBulkTerms({ colour: "color", prioritise: "prioritize" }, existing);
    expect(plan.added.map((entry) => entry.source)).toEqual(["prioritise"]);
    expect(plan.skipped).toEqual([
      { source: "colour", replacement: "color", outcome: "already-present" },
    ]);
  });

  it("keeps colour and Colour apart, because a house may want both", () => {
    /*
     * `caseSensitive` is per-rule, so two rules differing only in case are a
     * legitimate pair. Collapsing them here would be a product decision made in
     * a helper function.
     */
    const plan = planBulkTerms({ colour: "color", Colour: "color" }, []);
    expect(plan.added).toHaveLength(2);
  });

  it("skips a blank term", () => {
    const plan = planBulkTerms({ "   ": "orphan", colour: "color" }, []);
    expect(plan.added.map((entry) => entry.source)).toEqual(["colour"]);
    expect(plan.skipped).toEqual([{ source: "", replacement: "orphan", outcome: "within-paste" }]);
  });

  it("trims the term so a pasted line with trailing space still matches", () => {
    const existing = [rule({ id: "term-1", source: "colour" })];
    expect(planBulkTerms({ "  colour  ": "color" }, existing).added).toEqual([]);
  });

  it("adds nothing from an empty paste", () => {
    const plan = planBulkTerms({}, []);
    expect(plan.added).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });
});

describe("buildBulkRules", () => {
  it("gives every added pair its own free id", () => {
    const existing = [rule({ id: "term-1", source: "existing" })];
    const plan = planBulkTerms({ colour: "color", organise: "organize" }, existing);
    const rules = buildBulkRules(plan, existing);
    expect(rules.map((entry) => entry.id)).toEqual(["term-2", "term-3"]);
    expect(new Set(rules.map((entry) => entry.id)).size).toBe(2);
  });

  it("carries the pasted source and replacement through", () => {
    const rules = buildBulkRules(planBulkTerms({ colour: "color" }, []), []);
    expect(rules[0]?.source).toBe("colour");
    expect(rules[0]?.replacement).toBe("color");
  });

  it("produces rules indistinguishable from the single-add button's", () => {
    /*
     * The drift this pins: two writers of the same rule shape, one inline and
     * one behind a paste. If a default changes in one place only, a bulk-added
     * term would behave differently from a button-added one and nothing would
     * say so.
     */
    const fromPaste = buildBulkRules(planBulkTerms({ colour: "color" }, []), []);
    const fromButton = newTerminologyRule(nextTermId([]), "colour", "color");
    expect(fromPaste[0]).toEqual(fromButton);
  });

  it("builds nothing when the plan adds nothing", () => {
    const existing = [rule({ id: "term-1", source: "colour" })];
    const plan = planBulkTerms({ colour: "color" }, existing);
    expect(buildBulkRules(plan, existing)).toEqual([]);
  });
});
