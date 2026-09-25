import { describe, expect, it } from "vitest";
import {
  GovernanceProfileSchema,
  createGovernanceProfile,
  ScopePolicySchema,
  ProtectionPolicySchema,
  EditorialPolicySchema,
  TerminologyPolicySchema,
  GovernanceRuleSchema,
} from "../../../../src/core/domain/GovernanceProfile";
import { StyleProfileSchema } from "../../../../src/core/domain/StyleProfile";
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
  it("defaults editorial fields correctly", () => {
    const result = EditorialPolicySchema.parse({});
    expect(result.tone).toBe("neutral");
    expect(result.voice).toBe("third-person");
    expect(result.formality).toBe(50);
    expect(result.readingGradeTarget).toBeNull();
    expect(result.preferredSentenceLength).toBe(22);
    expect(result.vocabularyRegister).toBe("standard");
    expect(result.rhetoricalStyle).toBe("direct");
    expect(result.avoidWords).toEqual([]);
  });
});

describe("TerminologyPolicySchema", () => {
  it("defaults terminology fields correctly", () => {
    const result = TerminologyPolicySchema.parse({});
    expect(result.preferredTerms).toEqual({});
    expect(result.bannedTerms).toEqual([]);
    expect(result.requiredTerms).toEqual([]);
    expect(result.locale).toBe("en-US");
  });
});

describe("GovernanceRuleSchema", () => {
  it("validates a governance rule", () => {
    const rule = GovernanceRuleSchema.parse({
      id: uuidv4(),
      description: "Test rule",
      scope: "typography",
      severity: "mandatory",
      autoFix: false,
      protectedBehavior: "flag",
      remediation: "Fix it",
    });
    expect(rule.id).toBeTruthy();
    expect(rule.scope).toBe("typography");
    expect(rule.severity).toBe("mandatory");
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
        emDashSpacing: "spaced",
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
    expect(profile.terminology).toEqual({
      preferredTerms: {},
      bannedTerms: [],
      requiredTerms: [],
      locale: "en-US",
    });
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
        emDashSpacing: "spaced",
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
      editorial: { tone: "formal" },
      provenance: { createdAt: new Date().toISOString(), createdBy: "admin", lineage: [] },
    });
    expect(profile.rules).toHaveLength(1);
    expect(profile.terminology.preferredTerms).toEqual({ "e.g.": "for example" });
    expect(profile.scope.includeHeadersFooters).toBe(true);
    expect(profile.protection.protectQuotedText).toBe(true);
    expect(profile.editorial.tone).toBe("formal");
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
        emDashSpacing: "spaced",
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
        emDashSpacing: "spaced",
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
