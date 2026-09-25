import { describe, it, expect } from "vitest";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import { migrate, CURRENT_STATE_VERSION } from "../../../../src/core/state/migration";

describe("migration", () => {
  it("has a current version", () => {
    expect(CURRENT_STATE_VERSION).toBe(CURRENT_STATE_VERSION);
  });

  it("returns default state for null input", () => {
    const result = migrate(null);
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.profiles).toEqual([]);
    expect(result.profileHistory).toEqual({});
    expect(result.governanceHistory).toEqual({});
    expect(result.activeProfileId).toBeNull();
    expect(result.settings.telemetryDisabled).toBe(true);
  });

  it("returns default state for undefined input", () => {
    const result = migrate(undefined);
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.profiles).toEqual([]);
    expect(result.profileHistory).toEqual({});
  });

  it("returns default state for non-object input", () => {
    const result = migrate("not an object");
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.profiles).toEqual([]);
    expect(result.profileHistory).toEqual({});
  });

  it("returns default state for array input", () => {
    const result = migrate([]);
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.profiles).toEqual([]);
    expect(result.profileHistory).toEqual({});
  });

  it("migrates v1 state to v2 with empty profile history", () => {
    const v1 = {
      version: 1,
      profiles: [],
      activeProfileId: null,
      settings: { telemetryDisabled: false },
    };
    const result = migrate(v1);
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.profileHistory).toEqual({});
    expect(result.settings.telemetryDisabled).toBe(false);
  });

  it("migrates v0 (no version field) to v2", () => {
    const v0 = {
      profiles: [],
      activeProfileId: null,
      settings: {},
    };
    const result = migrate(v0);
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.profileHistory).toEqual({});
    expect(result.settings.telemetryDisabled).toBe(true);
  });

  it("migrates v0 with existing settings", () => {
    const v0 = {
      profiles: [],
      activeProfileId: null,
      settings: { openAiModel: "gpt-4o" },
    };
    const result = migrate(v0);
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.settings.openAiModel).toBe("gpt-4o");
    expect(result.settings.telemetryDisabled).toBe(true);
  });

  it("seeds profile history from v1 profiles", () => {
    const profile = createEmptyProfile("Migrated");
    const v1 = {
      version: 1,
      profiles: [profile],
      activeProfileId: profile.id,
      settings: {},
    };
    const result = migrate(v1);
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.profiles).toHaveLength(1);
    expect(result.profileHistory[profile.id]).toEqual([profile]);
    expect(result.activeProfileId).toBe(profile.id);
  });

  it("preserves valid profile history and discards invalid snapshots", () => {
    const profile = createEmptyProfile("History");
    const valid = { ...profile, name: "Snapshot 1" };
    const v1 = {
      version: 1,
      profiles: [profile],
      activeProfileId: profile.id,
      settings: {},
      profileHistory: {
        [profile.id]: [valid, { bad: "snapshot" }],
      },
    };
    const result = migrate(v1);
    expect(result.profileHistory[profile.id]).toEqual([valid]);
  });

  it("removes v3 plaintext credentials while preserving user consent", () => {
    const result = migrate({
      version: 3,
      profiles: [],
      activeProfileId: null,
      governanceProfiles: {},
      activeGovernanceProfileId: null,
      settings: {
        openAiApiKey: "sk-legacy-secret-value",
        llmProvider: "openai",
        spotReviewConsent: true,
        fullDocumentReviewConsent: true,
        semanticOptIn: true,
      },
    });

    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.settings).not.toHaveProperty("openAiApiKey");
    expect(result.settings.openAiCredentialMode).toBe("broker");
    expect(result.settings.spotReviewConsent).toBe(true);
    expect(result.settings.fullDocumentReviewConsent).toBe(true);
    expect(result.settings.semanticOptIn).toBe(true);
  });

  it("falls back to default state for unknown future versions", () => {
    const result = migrate({ version: 99, profiles: [], settings: {} });
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.profiles).toEqual([]);
    expect(result.profileHistory).toEqual({});
  });
});
