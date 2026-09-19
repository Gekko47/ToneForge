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
    expect(state.activeProfileId).toBeNull();
  });

  it("round-trips a profile", () => {
    const profile = createEmptyProfile("Saved");
    upsertProfile(profile);
    const state = loadState();
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]?.name).toBe("Saved");
  });

  it("upserts instead of duplicating", () => {
    const profile = createEmptyProfile("Dup");
    upsertProfile(profile);
    upsertProfile({ ...profile, name: "Dup Updated" });
    const state = loadState();
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]?.name).toBe("Dup Updated");
  });

  it("removes a profile", () => {
    const profile = createEmptyProfile("ToRemove");
    upsertProfile(profile);
    removeProfile(profile.id);
    expect(loadState().profiles).toHaveLength(0);
  });

  it("sets active profile id", () => {
    const profile = createEmptyProfile("Active");
    upsertProfile(profile);
    setActiveProfile(profile.id);
    expect(loadState().activeProfileId).toBe(profile.id);
    setActiveProfile(null);
    expect(loadState().activeProfileId).toBeNull();
  });
});
