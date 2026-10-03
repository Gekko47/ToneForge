import { describe, expect, it } from "vitest";
import { createEmptyProfile, StyleProfileSchema } from "../../../../src/core/domain/StyleProfile";
import { createEmptySemanticStyleProfile } from "../../../../src/core/domain/SemanticStyleProfile";
import {
  createGovernanceProfile,
  GovernanceProfileSchema,
  withExplicitEditorialFields,
} from "../../../../src/core/domain/GovernanceProfile";
import { resolveResolvedPolicy } from "../../../../src/core/domain/ResolvedPolicy";

const SEMANTIC = createEmptySemanticStyleProfile();

/**
 * Learned evidence in V2 form.
 *
 * Built from the V2 default rather than a hand-written literal, so a field added
 * to the schema does not make this fixture a type error and a "fix the fixture"
 * chore. The values that matter to each case are set explicitly below.
 */
function learnedProfile() {
  return StyleProfileSchema.parse({
    ...createEmptyProfile("Learned"),
    typography: { emDash: "hyphen" },
    // Wording lives on `language` (ADR-0110), and `houseStyle`'s own terminology
    // fields are gone (ND-13) because nothing read them.
    language: {
      terminology: [
        {
          id: "term-1",
          source: "color",
          replacement: "colour",
          caseSensitive: false,
          wholeWord: true,
          severity: "advisory",
          scope: {},
        },
      ],
      bannedTerms: ["obsolete"],
    },
    semantic: {
      ...SEMANTIC,
      tone: { ...SEMANTIC.tone, primary: "persuasive" },
      lexicalPreferences: { ...SEMANTIC.lexicalPreferences, toneAvoid: ["jargon"] },
    },
  });
}

describe("resolveResolvedPolicy", () => {
  it("keeps learned style separate from normative governance overrides", () => {
    const profile = learnedProfile();
    const governance = GovernanceProfileSchema.parse({
      ...createGovernanceProfile(profile),
      editorial: withExplicitEditorialFields(
        {
          tone: { primary: "restrained" },
          lexicalPreferences: { toneAvoid: ["slang"] },
        },
        ["tone", "lexicalPreferences"],
      ),
    });

    const resolved = resolveResolvedPolicy(profile, governance);

    expect(resolved.typography).toEqual(profile.typography);
    // Wording comes from the profile alone. Governance no longer merges terminology
    // in, so these are exactly what the learned profile said - which is the point of
    // the extraction: one place to author a house term, no ambiguity about which
    // record is in force.
    expect(resolved.language.terminology).toHaveLength(1);
    expect(resolved.language.terminology[0]?.source).toBe("color");
    expect(resolved.language.terminology[0]?.replacement).toBe("colour");
    expect(resolved.language.bannedTerms).toEqual(["obsolete"]);
    // A pinned dimension is normative in full. The whole tone group is replaced
    // by the author's, which is why the learned `secondary` list does not survive
    // — a per-leaf merge would have kept it, and would then have meant the author
    // had expressed an opinion about a dimension they never touched.
    expect(resolved.semantic.tone).toEqual({
      primary: "restrained",
      secondary: [],
      description: "",
    });
    expect(resolved.semantic.lexicalPreferences.toneAvoid).toEqual(["slang"]);
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

    expect(resolved.semantic.tone.primary).toBe("persuasive");
    expect(resolved.semantic.lexicalPreferences.toneAvoid).toEqual(["jargon"]);
    expect(resolved.language.terminology[0]?.replacement).toBe("colour");
    expect(resolved.language.bannedTerms).toEqual(["obsolete"]);
  });

  it("keeps an explicitly set governance value authoritative even when it equals the default", () => {
    const profile = learnedProfile();
    const governance = GovernanceProfileSchema.parse({
      ...createGovernanceProfile(profile),
      editorial: withExplicitEditorialFields({ formality: { score: 50 } }, ["formality"]),
    });

    const resolved = resolveResolvedPolicy(profile, governance);

    // 50 is the schema default, so without the pin this case would be
    // indistinguishable from an author who never mentioned formality.
    expect(resolved.editorial.formality).toEqual({ score: 50 });
    expect(resolved.semantic.formality).toEqual({ score: 50, label: "" });
  });

  /*
   * Terminology no longer crosses the governance boundary.
   *
   * These three cases used to cover the merge: governance preferred terms became
   * terminology rules, a governance term overrode a learned one for the same
   * word, and governance banned terms were unioned in. All three are gone, and the
   * case that replaces them is the one that matters — that a rule the author wrote
   * on the profile survives resolution with its own severity and identity intact.
   */
  it("passes profile terminology through unchanged, with no governance merge", () => {
    const profile = StyleProfileSchema.parse({
      ...createEmptyProfile("Learned"),
      language: {
        terminology: [
          { id: "learned", source: "color", replacement: "colour", severity: "mandatory" },
          { id: "other", source: "organise", replacement: "organize" },
        ],
        bannedTerms: ["obsolete"],
      },
    });

    const resolved = resolveResolvedPolicy(profile, createGovernanceProfile(profile));

    expect(resolved.language.terminology.map((rule) => [rule.id, rule.replacement])).toEqual([
      ["learned", "colour"],
      ["other", "organize"],
    ]);
    expect(resolved.language.terminology[0]?.severity).toBe("mandatory");
    expect(resolved.language.bannedTerms).toEqual(["obsolete"]);
  });

  it("applies schema defaults so a rule never sees a partial section", () => {
    /*
     * Parsing, not pass-through, is what `resolveLanguage` does now. A profile that
     * names no terminology at all must reach a rule as a complete section, or a rule
     * reading `language.terminology.length` sees `undefined`.
     */
    const profile = createEmptyProfile("Bare");
    const resolved = resolveResolvedPolicy(profile, createGovernanceProfile(profile));

    expect(resolved.language.terminology).toEqual([]);
    expect(resolved.language.bannedTerms).toEqual([]);
    // ND-13: the house-style wording fields are gone, so there is nothing left
    // there to default. Capitalisation still survives there and is what the
    // legacy title-case rule reads.
    expect(resolved.houseStyle.capitalization.titleCaseWords).toEqual([]);
  });

  it("no longer carries terminology on the house-style section (ND-13)", () => {
    const profile = createEmptyProfile("NoHouseTerminology");
    const resolved = resolveResolvedPolicy(profile, createGovernanceProfile(profile));

    // The schema no longer accepts the keys, so this asserts the contract rather
    // than the current stored value: a future edit that re-adds them cannot
    // produce a profile carrying them.
    expect(Object.keys(resolved.houseStyle)).not.toContain("preferredTerminology");
    expect(Object.keys(resolved.houseStyle)).not.toContain("bannedTerms");
  });
});
