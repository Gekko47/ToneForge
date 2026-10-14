/**
 * The findings-by-type projection tests.
 *
 * The projection is pure, so these tests need no Office mock and no React.
 * They pin the ordering, the counts, the icon mapping, and the fallback.
 */

import { describe, expect, it } from "vitest";
import type { Finding } from "../../../src/core/domain/Finding";
import { iconForCategory, projectFindingsByType } from "../../../src/taskpane/findingsByType";

/** Build a minimal finding with the fields the projection reads. */
function finding(overrides: Partial<Finding> & Pick<Finding, "id" | "category">): Finding {
  return {
    kind: "deterministic",
    severity: "warning",
    message: "test finding",
    range: { start: 0, end: 1, unit: "character" },
    ...overrides,
  } as Finding;
}

describe("iconForCategory", () => {
  it("maps typography categories to the styles icon", () => {
    expect(iconForCategory("typography.emDash")).toBe("styles");
  });

  it("maps language categories to the deterministic review icon", () => {
    expect(iconForCategory("language.terminology.preferred")).toBe("deterministicReview");
  });

  it("maps formatting categories to the styles icon", () => {
    expect(iconForCategory("formatting.headingStyle")).toBe("styles");
  });

  it("maps house style categories to the governance icon", () => {
    expect(iconForCategory("houseStyle.capitalization.titleCase")).toBe("governance");
  });

  it("falls back to the deterministic review icon for unknown categories", () => {
    expect(iconForCategory("unknown.something")).toBe("deterministicReview");
  });
});

/**
 * The group name — what a row says it is.
 *
 * The category a finding prints is a key: `typography.whitespace`. The heading a
 * reader sees is the rule's name, and the subtext is the domain it belongs to.
 * These tests pin the two together so the row and the profile editor agree.
 */
describe("group naming", () => {
  it("names a rule after its leaf and the row after the domain", () => {
    const groups = projectFindingsByType([
      finding({ id: "a", category: "typography.whitespace", ruleId: "typography/whitespace" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.ruleName).toBe("Whitespace");
    expect(groups[0]?.parent).toBe("Typography");
  });

  it("names a language rule after the rule, not the category", () => {
    const groups = projectFindingsByType([
      finding({
        id: "a",
        category: "language.capitalisation.headingCase",
        ruleId: "language/capitalisation",
      }),
    ]);

    expect(groups[0]?.ruleName).toBe("HeadingCase");
    expect(groups[0]?.parent).toBe("Language");
  });

  it("names a formatting finding after the domain that owns it", () => {
    const groups = projectFindingsByType([
      finding({ id: "a", category: "formatting.headingStyle" }),
    ]);

    expect(groups[0]?.ruleName).toBe("HeadingStyle");
    expect(groups[0]?.parent).toBe("Document formatting");
  });

  it("names a house style finding after house style", () => {
    const groups = projectFindingsByType([
      finding({ id: "a", category: "houseStyle.capitalization.titleCase" }),
    ]);

    expect(groups[0]?.ruleName).toBe("TitleCase");
    expect(groups[0]?.parent).toBe("House style");
  });

  it("always names a rule, even for an unknown category", () => {
    const groups = projectFindingsByType([finding({ id: "a", category: "unknown.something" })]);

    expect(groups[0]?.ruleName).toBe("Something");
    expect(groups[0]?.parent).toBe("Style");
  });
});

describe("projectFindingsByType", () => {
  it("returns an empty array for no findings", () => {
    expect(projectFindingsByType([])).toEqual([]);
  });

  it("groups findings by ruleId, not category", () => {
    const findings = [
      finding({ id: "1", category: "typography.emDash", ruleId: "typography/dashes" }),
      finding({ id: "2", category: "typography.enDashSpacing", ruleId: "typography/dashes" }),
    ];

    const groups = projectFindingsByType(findings);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("typography/dashes");
    expect(groups[0]?.count).toBe(2);
    expect(groups[0]?.findings.map((f) => f.id)).toEqual(["1", "2"]);
  });

  it("falls back to category when ruleId is absent", () => {
    const findings = [
      finding({ id: "1", category: "formatting.headingStyle" }),
      finding({ id: "2", category: "formatting.headingStyle" }),
    ];

    const groups = projectFindingsByType(findings);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("formatting.headingStyle");
    expect(groups[0]?.count).toBe(2);
  });

  it("sorts groups by count descending, then label ascending", () => {
    const findings = [
      finding({ id: "1", category: "typography.emDash", ruleId: "a" }),
      finding({ id: "2", category: "language.date", ruleId: "b" }),
      finding({ id: "3", category: "language.number", ruleId: "c" }),
      finding({ id: "4", category: "language.currency", ruleId: "d" }),
    ];

    const groups = projectFindingsByType(findings);
    expect(groups.map((g) => g.key)).toEqual(["d", "b", "c", "a"]);
  });

  it("preserves document order within a group", () => {
    const findings = [
      finding({ id: "1", category: "typography.emDash", ruleId: "a" }),
      finding({ id: "2", category: "typography.emDash", ruleId: "a" }),
      finding({ id: "3", category: "typography.emDash", ruleId: "a" }),
    ];

    const groups = projectFindingsByType(findings);
    expect(groups[0]?.findings.map((f) => f.id)).toEqual(["1", "2", "3"]);
  });

  it("produces one group per ruleId, even with the same category", () => {
    const findings = [
      finding({ id: "1", category: "typography.emDash", ruleId: "typography/emDashSpacing" }),
      finding({ id: "2", category: "typography.emDash", ruleId: "typography/emDashReplacement" }),
    ];

    const groups = projectFindingsByType(findings);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.key).not.toBe(groups[1]?.key);
  });

  it("sets the icon from the category", () => {
    const findings = [finding({ id: "1", category: "language.date", ruleId: "a" })];

    const groups = projectFindingsByType(findings);
    expect(groups[0]?.icon).toBe("deterministicReview");
  });
});
