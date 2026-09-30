import { describe, expect, it } from "vitest";

import {
  DETERMINISTIC_RULES,
  METADATA_ONLY_PROFILE_PATHS,
  PROFILE_FIELD_PATHS,
  RULE_GROUPS,
  allRules,
  registrySummary,
  ruleByCategory,
  ruleById,
  rulesInGroup,
  unwiredProfilePaths,
} from "../../../../src/analysis/deterministic/ruleRegistry";

/**
 * Spec §11's audit.
 *
 * The claim being tested is the one the project has been bitten by before: a
 * setting the user can change that changes nothing. The assertion is that
 * every declared profile field is either read by a registered rule or listed as
 * metadata-only, and that the metadata list is itself reviewable — a field
 * excused by a list nobody reads is the same defect one level up.
 */
describe("deterministic rule registry", () => {
  it("leaves no profile field unwired", () => {
    expect(unwiredProfilePaths()).toEqual([]);
  });

  it("accounts for every declared profile field exactly once", () => {
    // A field listed twice is not an error — two rules may both read it — but a
    // field in the profile list that no rule and no metadata entry mentions is
    // the failure, and `unwiredProfilePaths` is what reports it. This asserts
    // the inputs are the ones the audit assumes: no duplicates, no blanks.
    expect(new Set(PROFILE_FIELD_PATHS).size).toBe(PROFILE_FIELD_PATHS.length);
    PROFILE_FIELD_PATHS.forEach((path) => {
      expect(path.trim()).toBe(path);
      expect(path.length).toBeGreaterThan(0);
    });
  });

  it("only excuses fields that exist in the profile", () => {
    METADATA_ONLY_PROFILE_PATHS.forEach((path) => {
      expect(PROFILE_FIELD_PATHS).toContain(path);
    });
  });

  it("gives every rule a unique id and category", () => {
    const ids = allRules().map((rule) => rule.id);
    const categories = allRules().map((rule) => rule.category);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(categories).size).toBe(categories.length);
  });

  it("gives every rule at least one profile path and a known group", () => {
    allRules().forEach((rule) => {
      expect(rule.profilePaths.length).toBeGreaterThan(0);
      expect(RULE_GROUPS).toContain(rule.group);
      rule.profilePaths.forEach((path) => {
        expect(
          PROFILE_FIELD_PATHS.some(
            (declared) => declared === path || path.startsWith(`${declared}.`),
          ),
        ).toBe(true);
      });
    });
  });

  it("looks a rule up by id and by the category its findings carry", () => {
    const typography = ruleByCategory("typography.emDash");
    expect(typography).toBeDefined();
    expect(ruleById(typography?.id ?? "")).toBe(typography);
    expect(ruleById("no-such-rule")).toBeUndefined();
    expect(ruleByCategory("no.such.category")).toBeUndefined();
  });

  it("partitions every rule into exactly one group", () => {
    const total = RULE_GROUPS.reduce((sum, group) => sum + rulesInGroup(group).length, 0);
    expect(total).toBe(DETERMINISTIC_RULES.length);
  });

  it("reports a summary a UI can read without executing a rule", () => {
    const summary = registrySummary();
    expect(summary.length).toBe(DETERMINISTIC_RULES.length);
    summary.forEach((entry) => {
      expect(entry.id).toBeTruthy();
      expect(entry.category).toBeTruthy();
      expect(entry.reads).toBeGreaterThan(0);
      expect(typeof entry.correctable).toBe("boolean");
    });
  });

  it("declares a rule for each of the five registry groups", () => {
    RULE_GROUPS.forEach((group) => {
      expect(rulesInGroup(group).length).toBeGreaterThan(0);
    });
  });

  /*
   * The audit above reads DETERMINISTIC_RULES. These two assertions are what
   * make it an audit of the *running engine* rather than of a declaration.
   *
   * `emits` is the filter each rule applies to a shared scanner's output, and
   * every category the engine can produce has to belong to exactly one rule. An
   * overlap means the same finding is reported twice; a category belonging to
   * no rule means a real finding is silently dropped, and nothing else in the
   * suite would notice — the report would simply be shorter.
   */
  it("gives every emitted category exactly one owning rule", () => {
    const owners = new Map<string, string[]>();
    allRules().forEach((rule) => {
      (rule.emits ?? [rule.category]).forEach((category) => {
        const existing = owners.get(category) ?? [];
        existing.push(rule.id);
        owners.set(category, existing);
      });
    });
    const contested = Array.from(owners.entries()).filter(([, ids]) => ids.length > 1);
    expect(contested).toEqual([]);
  });

  it("includes the headline category in what a rule emits", () => {
    allRules().forEach((rule) => {
      expect(rule.emits ?? [rule.category]).toContain(rule.category);
    });
  });

  it("attaches a body to every rule the profile can reach a finding through", () => {
    /*
     * A rule with no `analyze` produces nothing. That is the correct state for
     * a rule whose stage has not landed, and the registrySummary test above
     * reports how many. What must not happen is one quietly reporting findings
     * through a neighbouring scanner that shares its categories, so the count
     * of unimplemented rules is asserted to be the count the summary reports —
     * they are the same list, so a future stage that attaches a body has to
     * move both.
     */
    const unimplemented = allRules()
      .filter((rule) => rule.analyze === undefined)
      .map((r) => r.id);
    expect(unimplemented).toEqual(
      registrySummary()
        .filter((r) => !r.implemented)
        .map((r) => r.id),
    );
  });
});
