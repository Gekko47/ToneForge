import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createEmptyProfile } from "../../../../src/core/domain/index";
import {
  loadState,
  upsertProfile,
  removeProfile,
  setActiveProfile,
  saveState,
} from "../../../../src/core/state/index";

describe("persistence", () => {
  let originalOffice: unknown;

  beforeEach(() => {
    originalOffice = (globalThis as { Office?: unknown }).Office;
    (globalThis as { Office?: unknown }).Office = undefined;
    window.localStorage.clear();
  });

  afterEach(() => {
    (globalThis as { Office?: unknown }).Office = originalOffice;
    window.localStorage.clear();
  });

  it("reads and writes through jsdom window storage", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    saveState({
      version: 2,
      profiles: [],
      profileHistory: {},
      activeProfileId: null,
      settings: {
        llmProvider: "mock",
        spotReviewConsent: false,
        fullDocumentReviewConsent: false,
        semanticOptIn: false,
        telemetryDisabled: false,
      },
      governanceProfiles: {},
      activeGovernanceProfileId: null,
    });

    expect(loadState().settings.telemetryDisabled).toBe(false);
    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();
  });

  it("round-trips a profile", () => {
    const profile = createEmptyProfile("Saved");
    upsertProfile(profile);
    const state = loadState();
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]?.name).toBe("Saved");
    expect(state.profileHistory[profile.id]).toHaveLength(1);
  });

  it("upserts instead of duplicating", () => {
    const profile = createEmptyProfile("Dup");
    upsertProfile(profile);
    upsertProfile({ ...profile, name: "Dup Updated" });
    const state = loadState();
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]?.name).toBe("Dup Updated");
    expect(state.profileHistory[profile.id]).toHaveLength(2);
  });

  it("does not append a duplicate snapshot on unchanged save", () => {
    const profile = createEmptyProfile("Stable");
    upsertProfile(profile);
    upsertProfile({ ...profile });
    const state = loadState();
    expect(state.profileHistory[profile.id]).toHaveLength(1);
  });

  it("removes a profile and its history", () => {
    const profile = createEmptyProfile("ToRemove");
    upsertProfile(profile);
    upsertProfile({ ...profile, name: "ToRemove Updated" });
    removeProfile(profile.id);
    const state = loadState();
    expect(state.profiles).toHaveLength(0);
    expect(state.profileHistory[profile.id]).toBeUndefined();
  });

  it("sets active profile id", () => {
    const profile = createEmptyProfile("Active");
    upsertProfile(profile);
    setActiveProfile(profile.id);
    expect(loadState().activeProfileId).toBe(profile.id);
    setActiveProfile(null);
    expect(loadState().activeProfileId).toBeNull();
  });

  it("records a version bump as a new history snapshot", () => {
    const profile = createEmptyProfile("Versioned");
    upsertProfile(profile);
    const bumped = { ...profile, version: { major: 1, minor: 1, patch: 0 } };
    upsertProfile(bumped);
    const state = loadState();
    expect(state.profiles[0]?.version).toEqual({ major: 1, minor: 1, patch: 0 });
    expect(state.profileHistory[profile.id]).toHaveLength(2);
  });
});
