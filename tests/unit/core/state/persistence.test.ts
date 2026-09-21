import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEmptyProfile } from "../../../../src/core/domain/index";
import {
  loadState,
  upsertProfile,
  removeProfile,
  setActiveProfile,
} from "../../../../src/core/state/index";

describe("persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns default state when empty", () => {
    const state = loadState();
    expect(state.profiles).toEqual([]);
    expect(state.profileHistory).toEqual({});
    expect(state.activeProfileId).toBeNull();
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
