import { describe, expect, it } from "vitest";
import {
  GovernanceProfileSchema,
  createGovernanceProfile,
  ScopePolicySchema,
  ProtectionPolicySchema,
  EditorialPolicySchema,
  GovernanceRuleSchema,
  ruleForSource,
  EDITORIAL_OVERRIDE_FIELDS,
} from "../../../../src/core/domain/GovernanceProfile";
import { StyleProfileSchema, createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import { SEMANTIC_DIMENSIONS } from "../../../../src/core/domain/SemanticStyleProfile";
import { v4 as uuidv4 } from "uuid";

describe("ScopePolicySchema", () => {
  it("defaults all include flags correctly", () => {
    const result = ScopePolicySchema.parse({});
    expect(result.includeBody).toBe(true);
    expect(result.includeHeadersFooters).toBe(false);
    expect(result.includeComments).toBe(false);
    expect(result.includeFootnotesEndnotes).toBe(false);
    expect(result.includeTextBoxes).toBe(false);
    expect(result.includeShapes).toBe(false);
    expect(result.includeSmartArt).toBe(false);
    expect(result.includeContentControls).toBe(false);
    expect(result.includeFields).toBe(false);
    expect(result.includeImages).toBe(false);
    expect(result.includeTables).toBe(true);
    expect(result.includeLists).toBe(true);
  });
});

describe("ProtectionPolicySchema", () => {
  it("defaults protection flags correctly", () => {
    const result = ProtectionPolicySchema.parse({});
    expect(result.protectQuotedText).toBe(true);
    expect(result.protectCaptions).toBe(true);
    expect(result.protectTrackedDeletions).toBe(true);
    expect(result.protectComments).toBe(true);
    expect(result.protectTextBoxes).toBe(true);
    expect(result.protectShapes).toBe(true);
    expect(result.protectAltText).toBe(true);
    expect(result.protectHeadersFooters).toBe(false);
    expect(result.protectFields).toBe(false);
    expect(result.protectFootnotes).toBe(false);
    expect(result.userLockedRanges).toEqual([]);
  });
});

describe("EditorialPolicySchema", () => {
  it("leaves every dimension unpinned, so learned evidence is not overridden", () => {
    /*
     * V1 defaulted each editorial field to a value and then relied on
     * `explicitFields` to decide whether it was an opinion. V2 makes every
     * dimension partial *and* pins by name, so an untouched policy parses to
     * sixteen empty objects and an empty pin list — and `resolveSemantic` then
     * passes learned evidence through untouched. A default that reads as a value
     * is what made the old rule need an override list in the first place.
     */
    const result = EditorialPolicySchema.parse({});
    expect(result.explicitFields).toEqual([]);
    expect(result.tone).toEqual({});
    expect(result.formality).toEqual({});
    expect(result.lexicalPreferences).toEqual({});
    expect(result.transitions).toBeUndefined();
    expect(result.rhetoricalStyle).toBeUndefined();
  });

  it("names every pinnable dimension, and no others", () => {
    /*
     * The pin list is the whole of an override. A dimension the author cannot
     * name cannot govern, and a name that is not a dimension would be a pin that
     * silently matches nothing.
     */
    expect([...EDITORIAL_OVERRIDE_FIELDS].sort()).toEqual([...SEMANTIC_DIMENSIONS].sort());
    expect(EDITORIAL_OVERRIDE_FIELDS).toHaveLength(16);
  });
});

describe("terminology has left the governance contract", () => {
  /*
   * Governance governs protection and editability; house wording is a
   * deterministic-review standard on the style profile.
   *
   * Asserted structurally rather than by absence of a compile error: a schema
   * brought back would parse silently, and the whole point is that these four
   * fields must not be authorable here.
   */
  it("no longer parses on a governance profile", () => {
    const profile = createEmptyProfile("Test");
    const parsed = GovernanceProfileSchema.safeParse({
      ...createGovernanceProfile(profile),
      terminology: { preferredTerms: { color: "colour" } },
    });

    expect(parsed.success).toBe(true);
    // Zod strips unknown keys, so the stored value is discarded rather than
    // honoured — which is the whole point of removing the field.
    if (parsed.success) expect(parsed.data).not.toHaveProperty("terminology");
  });
});

describe("GovernanceRuleSchema", () => {
  it("validates a governance rule", () => {
    const rule = GovernanceRuleSchema.parse({
      id: uuidv4(),
      description: "Test rule",
      scope: "typography",
      source: "typography",
      severity: "mandatory",
      autoFix: false,
      protectedBehavior: "flag",
      remediation: "Fix it",
    });
    expect(rule.id).toBeTruthy();
    expect(rule.scope).toBe("typography");
    expect(rule.severity).toBe("mandatory");
  });

  /**
   * A rule with no `source` matched nothing at plan time: the planner had no way
   * to know which finding it referred to, so `autoFix` and `severity` were
   * fields nobody read. Requiring the binding is what makes the rule reachable.
   */
  it("refuses a rule that is not bound to a finding category", () => {
    expect(() =>
      GovernanceRuleSchema.parse({
        id: uuidv4(),
        description: "Unbound rule",
        scope: "typography",
        severity: "advisory",
      }),
    ).toThrow();
  });

  it("refuses a source that is not a real finding category", () => {
    // A closed list, so a typo cannot silently produce a rule that never fires.
    expect(() =>
      GovernanceRuleSchema.parse({
        id: uuidv4(),
        description: "Misspelled category",
        scope: "typography",
        source: "houseStyle.terminologyy",
        severity: "advisory",
      }),
    ).toThrow();
  });
});

describe("ruleForSource", () => {
  const rule = GovernanceRuleSchema.parse({
    id: uuidv4(),
    description: "Terminology is mandatory",
    scope: "houseStyle",
    source: "houseStyle.terminology",
    severity: "mandatory",
    autoFix: true,
  });

  it("binds a rule to its finding category", () => {
    expect(ruleForSource([rule], "houseStyle.terminology")?.id).toBe(rule.id);
  });

  it("returns null for a category no rule governs", () => {
    expect(ruleForSource([rule], "typography")).toBeNull();
  });
});

describe("GovernanceProfileSchema", () => {
  it("creates a valid governance profile", () => {
    const style = StyleProfileSchema.parse({
      id: uuidv4(),
      name: "Test Profile",
      revision: 1,
      measured: {},
      semantic: {},
      typography: {
        emDash: "em",
        enDashSpacing: "spaced",
        doubleQuotes: "curly",
        singleQuotes: "curly",
        apostrophes: "curly",
        decimalSeparator: "dot",
        thousandsSeparator: "none",
        ellipsis: "ellipsis",
      },
      houseStyle: {
        preferredTerms: [],
        bannedTerms: [],
        requiredTerms: [],
        capitalization: { applyToHeadings: false, applyToBody: false },
        spellingVariants: [],
        dataTableEntries: [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const profile = createGovernanceProfile(style, "test-user");
    expect(profile.id).toBeTruthy();
    expect(profile.version).toBe(1);
    expect(profile.style).toEqual(style);
    expect(profile.rules).toEqual([]);
    // No `terminology`: wording belongs to the deterministic style profile, not to
    // governance, which governs protection and editability.
    expect(profile).not.toHaveProperty("terminology");
    expect(profile.scope).toEqual(ScopePolicySchema.parse({}));
    expect(profile.protection).toEqual(ProtectionPolicySchema.parse({}));
    expect(profile.editorial).toEqual(EditorialPolicySchema.parse({}));
    expect(profile.provenance.createdBy).toBe("test-user");
    expect(profile.provenance.lineage).toEqual([]);
  });

  it("validates with custom rules and terminology", () => {
    const style = StyleProfileSchema.parse({
      id: uuidv4(),
      name: "Test",
      revision: 1,
      measured: {},
      semantic: {},
      typography: {
        emDash: "em",
        enDashSpacing: "spaced",
        doubleQuotes: "curly",
        singleQuotes: "curly",
        apostrophes: "curly",
        decimalSeparator: "dot",
        thousandsSeparator: "none",
        ellipsis: "ellipsis",
      },
      houseStyle: {
        preferredTerms: [],
        bannedTerms: [],
        requiredTerms: [],
        capitalization: { applyToHeadings: false, applyToBody: false },
        spellingVariants: [],
        dataTableEntries: [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const profile = GovernanceProfileSchema.parse({
      id: uuidv4(),
      version: 2,
      style,
      rules: [
        {
          id: uuidv4(),
          description: "No em dash",
          scope: "typography",
          source: "typography",
          severity: "mandatory",
          autoFix: true,
          protectedBehavior: "flag",
          remediation: "Use en dash",
        },
      ],
      terminology: {
        preferredTerms: { "e.g.": "for example" },
        bannedTerms: ["irregardless"],
        requiredTerms: [],
        locale: "en-US",
      },
      scope: { includeBody: true, includeHeadersFooters: true },
      protection: { protectQuotedText: true, protectCaptions: true },
      // V1 shape: `tone` was a free string. It is carried into `tone.description`,
      // but **not** pinned: "formal" names no V2 trait, and a pin takes the whole
      // dimension, so pinning it would replace the learned `tone.primary` with the
      // schema default "neutral".
      editorial: { tone: "formal" },
      provenance: { createdAt: new Date().toISOString(), createdBy: "admin", lineage: [] },
    });
    expect(profile.rules).toHaveLength(1);
    expect(profile.scope.includeHeadersFooters).toBe(true);
    expect(profile.protection.protectQuotedText).toBe(true);
    expect(profile.editorial.tone).toEqual({ description: "formal" });
    expect(profile.editorial.explicitFields).toEqual([]);
  });
});

describe("createGovernanceProfile", () => {
  it("generates a unique ID per call", () => {
    const style = StyleProfileSchema.parse({
      id: uuidv4(),
      name: "Test",
      revision: 1,
      measured: {},
      semantic: {},
      typography: {
        emDash: "em",
        enDashSpacing: "spaced",
        doubleQuotes: "curly",
        singleQuotes: "curly",
        apostrophes: "curly",
        decimalSeparator: "dot",
        thousandsSeparator: "none",
        ellipsis: "ellipsis",
      },
      houseStyle: {
        preferredTerms: [],
        bannedTerms: [],
        requiredTerms: [],
        capitalization: { applyToHeadings: false, applyToBody: false },
        spellingVariants: [],
        dataTableEntries: [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const p1 = createGovernanceProfile(style);
    const p2 = createGovernanceProfile(style);
    expect(p1.id).not.toBe(p2.id);
  });

  it("sets createdAt to current time", () => {
    const style = StyleProfileSchema.parse({
      id: uuidv4(),
      name: "Test",
      revision: 1,
      measured: {},
      semantic: {},
      typography: {
        emDash: "em",
        enDashSpacing: "spaced",
        doubleQuotes: "curly",
        singleQuotes: "curly",
        apostrophes: "curly",
        decimalSeparator: "dot",
        thousandsSeparator: "none",
        ellipsis: "ellipsis",
      },
      houseStyle: {
        preferredTerms: [],
        bannedTerms: [],
        requiredTerms: [],
        capitalization: { applyToHeadings: false, applyToBody: false },
        spellingVariants: [],
        dataTableEntries: [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const profile = createGovernanceProfile(style);
    const created = new Date(profile.provenance.createdAt);
    expect(created.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
