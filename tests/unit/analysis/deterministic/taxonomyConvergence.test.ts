import { describe, expect, it } from "vitest";
import {
  DETERMINISTIC_RULES,
  registrySummary,
  ruleByCategory,
} from "../../../../src/analysis/deterministic/ruleRegistry";
import { findTerminologyIssues } from "../../../../src/rules/language";
import { LanguageConventionProfileSchema } from "../../../../src/core/domain/StyleProfile";
import {
  GOVERNANCE_RULE_SOURCES,
  GovernanceRuleSchema,
  ruleForSource,
} from "../../../../src/core/domain/GovernanceProfile";

/**
 * ND-12.
 *
 * The `language/terminology` rule emitted findings under the category
 * `houseStyle.terminology` while their own `profilePath` said
 * `language.terminology.<id>` — the category named a different profile section
 * than the field that produced it. The category is now
 * `language.terminology.preferred`, beside its siblings
 * `language.terminology.missing` and `language.bannedTerm`.
 *
 * This is the assertion the old shape failed: for every finding the rule can
 * produce, the family of its category and the family of its profile path must be
 * the same. A rule that emits across two families fails here, which is the general
 * form of the defect rather than a lookup of the one string that caused it.
 */

const rule = DETERMINISTIC_RULES.find((entry) => entry.id === "language/terminology");
if (rule === undefined) throw new Error("language/terminology is missing from the registry");

const emitted = rule.emits ?? [rule.category];

/** The profile section a dotted path or category belongs to. */
function familyOf(dotted: string): string {
  return dotted.split(".")[0] ?? "";
}

const FAMILY_PREFIXES = [
  "typography",
  "language",
  "houseStyle",
  "formatting",
  "structure",
] as const;

describe("the terminology rule emits only into the language family", () => {
  it("emits the renamed category", () => {
    expect(emitted).toContain("language.terminology.preferred");
  });

  it("no longer emits the category that contradicted its own profile path", () => {
    expect(emitted).not.toContain("houseStyle.terminology");
  });

  it("emits no category from the houseStyle family at all", () => {
    emitted.forEach((category) => {
      expect(familyOf(category)).not.toBe("houseStyle");
    });
  });

  it("keeps every emitted category within an admitted taxonomy family", () => {
    emitted.forEach((category) => {
      expect(FAMILY_PREFIXES).toContain(familyOf(category));
    });
  });
});

describe("every finding the rule produces agrees with its own declaration", () => {
  const findings = findTerminologyIssues({
    text: "The color is not set. Utilise the programme.",
    rules: LanguageConventionProfileSchema.parse({
      terminology: [
        { id: "colour", source: "color", replacement: "colour", severity: "mandatory" },
        { id: "programme", source: "programme", severity: "mandatory" },
        { id: "utilise", source: "utilise", severity: "mandatory" },
      ],
    }),
  });

  it("produced findings to compare", () => {
    expect(findings.length).toBeGreaterThan(0);
  });

  /*
   * `findTerminologyIssues` is shared: `language/terminology` and
   * `language/bannedTerm` each run it and keep the categories they own. So the
   * right claim is not "every finding belongs to *this* rule" but "every finding
   * is claimed by exactly one rule in the registry" - which is what stops an
   * unfiltered category from reaching a report with no owner.
   */
  it("files every one of them under a category exactly one rule claims", () => {
    findings.forEach((finding) => {
      expect(ruleByCategory(finding.category)?.id).toBeDefined();
    });
  });

  it("files every one of them into the language family", () => {
    findings.forEach((finding) => {
      expect(familyOf(finding.category)).toBe("language");
    });
  });

  it("puts every one of them in the same family as the profile field it names", () => {
    findings.forEach((finding) => {
      const path = finding.deterministic?.profilePath ?? "";
      expect(path.length).toBeGreaterThan(0);
      expect(familyOf(finding.category)).toBe(familyOf(path));
    });
  });

  it("still names the concrete profile field on every one", () => {
    findings.forEach((finding) => {
      expect(finding.deterministic?.profilePath).toMatch(/^language\.(terminology|bannedTerms)\b/);
    });
  });
});

describe("the registry resolves the category it declares", () => {
  it("maps the renamed category back to its owning rule", () => {
    expect(ruleByCategory("language.terminology.preferred")?.id).toBe("language/terminology");
  });

  it("no longer resolves the old category to anything", () => {
    expect(ruleByCategory("houseStyle.terminology")).toBeUndefined();
  });

  it("heads the summary a UI reads without executing a rule", () => {
    const summary = registrySummary().find((entry) => entry.id === "language/terminology");
    expect(summary?.category).toBe("language.terminology.preferred");
  });
});

describe("a governance rule can still bind to the category", () => {
  /*
   * The binding is by finding category, so renaming the category without
   * renaming the governance source would leave every terminology rule bound to
   * nothing - the same defect in the other direction, and one no amount of
   * testing the rule alone would catch.
   */
  it("accepts the renamed category as a rule source", () => {
    expect(GOVERNANCE_RULE_SOURCES).toContain("language.terminology.preferred");
  });

  it("resolves a governance rule written against it", () => {
    const governanceRule = GovernanceRuleSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      description: "Terminology is mandatory",
      scope: "houseStyle",
      source: "language.terminology.preferred",
      severity: "mandatory",
      autoFix: true,
    });
    expect(ruleForSource([governanceRule], "language.terminology.preferred")?.id).toBe(
      governanceRule.id,
    );
  });
});
