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
});
