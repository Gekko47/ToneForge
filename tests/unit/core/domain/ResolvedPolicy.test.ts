import { describe, expect, it } from "vitest";
import { createEmptyProfile, StyleProfileSchema } from "../../../../src/core/domain/StyleProfile";
import {
  createGovernanceProfile,
  GovernanceProfileSchema,
  withExplicitEditorialFields,
} from "../../../../src/core/domain/GovernanceProfile";
import { resolveResolvedPolicy } from "../../../../src/core/domain/ResolvedPolicy";

function learnedProfile() {
  return StyleProfileSchema.parse({
    ...createEmptyProfile("Learned"),
    typography: { emDash: "hyphen" },
    houseStyle: {
      preferredTerminology: { color: "colour" },
      bannedTerms: ["obsolete"],
    },
    semantic: { tone: "friendly", avoidWords: ["jargon"] },
  });
}

describe("resolveResolvedPolicy", () => {
  it("keeps learned style separate from normative governance overrides", () => {
    const profile = learnedProfile();
    const governance = GovernanceProfileSchema.parse({
      ...createGovernanceProfile(profile),
      terminology: {
        preferredTerms: { color: "brand-color" },
        bannedTerms: ["forbidden"],
      },
      editorial: {
        tone: "formal",
        avoidWords: ["slang"],
      },
    });

    const resolved = resolveResolvedPolicy(profile, governance);

    expect(resolved.typography).toEqual(profile.typography);
    expect(resolved.houseStyle.preferredTerminology).toEqual({ color: "brand-color" });
    expect(resolved.houseStyle.bannedTerms).toEqual(["obsolete", "forbidden"]);
    expect(resolved.semantic.tone).toBe("formal");
    expect(resolved.semantic.avoidWords).toEqual(["jargon", "slang"]);
    expect(resolved.provenance).toMatchObject({
      profileId: profile.id,
      profileRevision: profile.revision,
      governanceId: governance.id,
      governanceVersion: governance.version,
    });
  });

  it("does not replace learned evidence with default governance values", () => {
    const profile = learnedProfile();
    const resolved = resolveResolvedPolicy(profile, createGovernanceProfile(profile));

    expect(resolved.semantic.tone).toBe("friendly");
    expect(resolved.semantic.avoidWords).toEqual(["jargon"]);
    expect(resolved.houseStyle.preferredTerminology).toEqual({ color: "colour" });
    expect(resolved.houseStyle.bannedTerms).toEqual(["obsolete"]);
  });

  it("keeps an explicitly set governance value authoritative even when it equals the default", () => {
    const profile = learnedProfile();
    const governance = GovernanceProfileSchema.parse({
      ...createGovernanceProfile(profile),
      editorial: withExplicitEditorialFields({ tone: "neutral" }, ["tone"]),
    });

    const resolved = resolveResolvedPolicy(profile, governance);

    expect(resolved.editorial.tone).toBe("neutral");
    expect(resolved.semantic.tone).toBe("neutral");
  });

  /*
   * Governance is a record of preferred terms; the language profile's
   * terminology is a list of rules. The resolution has to make the second
   * enforceable from the first, and these three cases are the ones that decide
   * whether it does.
   */
  it("turns a governance preferred term into a terminology rule", () => {
    const profile = learnedProfile();
    const governance = GovernanceProfileSchema.parse({
      ...createGovernanceProfile(profile),
      terminology: { preferredTerms: { color: "brand-color" }, bannedTerms: [] },
    });

    const resolved = resolveResolvedPolicy(profile, governance);

    expect(resolved.language.terminology).toEqual([
      {
        id: "governance:color",
        source: "color",
        replacement: "brand-color",
        caseSensitive: false,
        wholeWord: true,
        severity: "advisory",
        scope: {},
      },
    ]);
  });

  it("lets a governance term replace a learned rule for the same word", () => {
    /*
     * Two rules for one word would report the same deviation twice with
     * different severities, and the user would see a finding they cannot act
     * on twice. The normative value is the one that should win.
     */
    const profile = StyleProfileSchema.parse({
      ...createEmptyProfile("Learned"),
      language: {
        terminology: [
          { id: "learned", source: "color", replacement: "colour", severity: "mandatory" },
          { id: "other", source: "organise", replacement: "organize" },
        ],
      },
    });
    const governance = GovernanceProfileSchema.parse({
      ...createGovernanceProfile(profile),
      terminology: { preferredTerms: { color: "brand-color" }, bannedTerms: [] },
    });

    const resolved = resolveResolvedPolicy(profile, governance);

    expect(resolved.language.terminology.map((rule) => [rule.id, rule.replacement])).toEqual([
      ["other", "organize"],
      ["governance:color", "brand-color"],
    ]);
  });

  it("merges governance banned terms into the language profile", () => {
    const profile = StyleProfileSchema.parse({
      ...createEmptyProfile("Learned"),
      language: { bannedTerms: ["obsolete"] },
    });
    const governance = GovernanceProfileSchema.parse({
      ...createGovernanceProfile(profile),
      terminology: { preferredTerms: {}, bannedTerms: ["forbidden", "obsolete"] },
    });

    const resolved = resolveResolvedPolicy(profile, governance);

    // Deduped, not concatenated: the same banned term in both records is one
    // rule, and reporting it twice would be the duplication spec 4.3 is about.
    expect(resolved.language.bannedTerms).toEqual(["obsolete", "forbidden"]);
  });
});
