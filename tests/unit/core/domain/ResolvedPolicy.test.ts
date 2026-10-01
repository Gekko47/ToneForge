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
    houseStyle: {
      preferredTerminology: { color: "colour" },
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
      terminology: {
        preferredTerms: { color: "brand-color" },
        bannedTerms: ["forbidden"],
      },
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
    expect(resolved.houseStyle.preferredTerminology).toEqual({ color: "brand-color" });
    expect(resolved.houseStyle.bannedTerms).toEqual(["obsolete", "forbidden"]);
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
    expect(resolved.houseStyle.preferredTerminology).toEqual({ color: "colour" });
    expect(resolved.houseStyle.bannedTerms).toEqual(["obsolete"]);
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
