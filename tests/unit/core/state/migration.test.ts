import { describe, it, expect } from "vitest";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import { migrate, CURRENT_STATE_VERSION } from "../../../../src/core/state/migration";

describe("migration", () => {
  it("has a current version at or beyond the v8 provider-connection work", () => {
    // A floor rather than an equality. This file covers the legacy migration
    // chain; pinning the exact current version here made every later bump fail a
    // test that had no opinion about it.
    expect(CURRENT_STATE_VERSION).toBeGreaterThanOrEqual(8);
  });

  it("returns default state for null input", () => {
    const result = migrate(null);
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.profileRecords).toEqual({});
    expect(result.governanceHistory).toEqual({});
    expect(result.activeProfileId).toBeNull();
    expect(result.settings.telemetryDisabled).toBe(true);
  });

  it("returns default state for undefined input", () => {
    const result = migrate(undefined);
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.profileRecords).toEqual({});
  });

  it("returns default state for non-object input", () => {
    const result = migrate("not an object");
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.profileRecords).toEqual({});
  });

  it("returns default state for array input", () => {
    const result = migrate([]);
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.profileRecords).toEqual({});
  });

  it("migrates v1 state with empty profile history", () => {
    const v1 = {
      version: 1,
      profiles: [],
      activeProfileId: null,
      settings: { telemetryDisabled: false },
    };
    const result = migrate(v1);
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.profileRecords).toEqual({});
    expect(result.settings.telemetryDisabled).toBe(false);
  });

  it("migrates v0 (no version field)", () => {
    const v0 = {
      profiles: [],
      activeProfileId: null,
      settings: {},
    };
    const result = migrate(v0);
    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.profileRecords).toEqual({});
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

  it("folds a v1 profile into a record with a created revision", () => {
    const profile = createEmptyProfile("Migrated");
    const v1 = {
      version: 1,
      profiles: [profile],
      activeProfileId: profile.id,
      settings: {},
    };
    const result = migrate(v1);
    const record = result.profileRecords[profile.id];
    expect(record).toBeDefined();
    expect(record?.name).toBe("Migrated");
    expect(record?.revisions).toHaveLength(1);
    expect(record?.revisions[0]?.action).toBe("created");
    expect(record?.draft?.name).toBe("Migrated");
    expect(result.activeProfileId).toBe(profile.id);
  });

  it("preserves valid history snapshots and discards invalid ones", () => {
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
    const record = result.profileRecords[profile.id];
    // Only the one valid snapshot survives; the malformed entry is dropped.
    expect(record?.revisions).toHaveLength(1);
    expect(record?.revisions[0]?.profile.name).toBe("Snapshot 1");
  });

  it("discards a corrupt record without discarding the others", () => {
    const kept = createEmptyProfile("Kept");
    const dropped = createEmptyProfile("Dropped");
    const v6 = {
      version: 6,
      profiles: [kept, dropped],
      activeProfileId: kept.id,
      settings: {},
      profileHistory: {
        [dropped.id]: [{ not: "a profile" }],
      },
    };
    const result = migrate(v6);
    expect(result.profileRecords[kept.id]).toBeDefined();
    expect(result.profileRecords[dropped.id]).toBeDefined();
    expect(result.profileRecords[dropped.id]?.revisions).toHaveLength(1);
  });

  it("seeds a governance profile for every migrated record", () => {
    const profile = createEmptyProfile("Governed");
    const result = migrate({ version: 5, profiles: [profile], settings: {} });
    expect(result.governanceProfiles[profile.id]).toBeDefined();
    expect(result.governanceProfiles[profile.id]?.style.name).toBe("Governed");
    expect(result.governanceHistory[profile.id]).toHaveLength(1);
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
    expect(result.profileRecords).toEqual({});
  });

  it("reads an already-current state without rebuilding records", () => {
    const profile = createEmptyProfile("Current");
    const v7 = {
      version: 7,
      profiles: [],
      activeProfileId: null,
      settings: {},
      profileRecords: {
        [profile.id]: {
          id: profile.id,
          name: "Current",
          draft: profile,
          published: [],
          revisions: [],
          activePublishedRevision: null,
          nextRevision: 2,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        },
      },
    };
    const result = migrate(v7);
    expect(result.profileRecords[profile.id]?.nextRevision).toBe(2);
  });
});
