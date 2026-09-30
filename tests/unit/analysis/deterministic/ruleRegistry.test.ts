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
});
