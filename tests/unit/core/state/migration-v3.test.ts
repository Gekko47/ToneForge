import { describe, expect, it } from "vitest";
import { migrate, CURRENT_STATE_VERSION } from "../../../../src/core/state/migration";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";

describe("migration v3", () => {
  it("has version 3", () => {
    expect(CURRENT_STATE_VERSION).toBe(3);
  });

  it("returns default state with governance fields for null input", () => {
    const result = migrate(null);
    expect(result.version).toBe(3);
    expect(result.governanceProfiles).toEqual({});
    expect(result.activeGovernanceProfileId).toBeNull();
  });

  it("returns default state with governance fields for undefined input", () => {
    const result = migrate(undefined);
    expect(result.version).toBe(3);
    expect(result.governanceProfiles).toEqual({});
    expect(result.activeGovernanceProfileId).toBeNull();
  });

  it("migrates v2 state to v3 with governance profiles seeded from active StyleProfile", () => {
    const profile = createEmptyProfile("Test Profile");
    const profileId = profile.id;
    const v2 = {
      version: 2,
      profiles: [profile],
      activeProfileId: profileId,
      settings: { telemetryDisabled: true },
    };
    const result = migrate(v2);
    expect(result.version).toBe(3);
    expect(result.governanceProfiles[profileId]).toBeDefined();
    expect(result.activeGovernanceProfileId).toBe(profileId);
    expect(result.governanceProfiles[profileId]!.style.id).toBe(profileId);
    expect(result.governanceProfiles[profileId]!.version).toBe(1);
    expect(result.governanceProfiles[profileId]!.rules).toEqual([]);
  });

  it("migrates v2 state with no active profile — governanceProfiles empty", () => {
    const v2 = {
      version: 2,
      profiles: [],
      activeProfileId: null,
      settings: { telemetryDisabled: true },
    };
    const result = migrate(v2);
    expect(result.version).toBe(3);
    expect(result.governanceProfiles).toEqual({});
    expect(result.activeGovernanceProfileId).toBeNull();
  });

  it("preserves existing governance profiles on v3 input", () => {
    const profile = createEmptyProfile("Existing");
    const v3 = {
      version: 3,
      profiles: [],
      governanceProfiles: {
        [profile.id]: {
          id: profile.id,
          version: 1,
          style: profile,
          rules: [],
          terminology: {},
          scope: {},
          protection: {},
          editorial: {},
          provenance: { createdAt: new Date().toISOString(), createdBy: "test", lineage: [] },
        },
      },
      activeGovernanceProfileId: profile.id,
      settings: { telemetryDisabled: true },
    };
    const result = migrate(v3);
    expect(result.governanceProfiles[profile.id]).toBeDefined();
    expect(result.activeGovernanceProfileId).toBe(profile.id);
  });

  it("ignores invalid governance profiles during migration", () => {
    const v3 = {
      version: 3,
      profiles: [],
      governanceProfiles: {
        "bad-id": { not: "valid" },
      },
      activeGovernanceProfileId: "bad-id",
      settings: { telemetryDisabled: true },
    };
    const result = migrate(v3);
    expect(result.governanceProfiles["bad-id"]).toBeUndefined();
    expect(result.activeGovernanceProfileId).toBe("bad-id");
  });
});
