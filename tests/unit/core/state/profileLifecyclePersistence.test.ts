import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import {
  activatePublished,
  publishDraft,
  type ProfileLifecycleState,
} from "../../../../src/core/domain/ProfileLifecycle";
import { CURRENT_STATE_VERSION, migrate } from "../../../../src/core/state/migration";
import {
  loadProfileLifecycle,
  loadState,
  saveProfileLifecycle,
  upsertProfile,
} from "../../../../src/core/state/persistence";

describe("profile lifecycle persistence", () => {
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

  it("seeds a published lifecycle from a stored profile with no draft", () => {
    const profile = createEmptyProfile("House");
    upsertProfile(profile);

    const state = loadState();
    const lifecycle = state.profileLifecycles[profile.id];

    expect(lifecycle).toBeDefined();
    expect(lifecycle?.published).toHaveLength(1);
    expect(lifecycle?.draft).toBeNull();
    expect(lifecycle?.activePublishedId).toBe(profile.id);
  });

  it("round-trips a draft and an explicitly activated published version", () => {
    const profile = createEmptyProfile("House");
    upsertProfile(profile);

    const seeded = loadProfileLifecycle(profile.id);
    const base = seeded.published[0];
    if (!base) throw new Error("expected a seeded published version");
    const withDraft: ProfileLifecycleState = {
      ...seeded,
      draft: { ...base, name: "House draft" },
    };
    const { state: publishedState } = publishDraft(withDraft, "2026-01-01T00:00:00.000Z");
    const firstPublishedId = publishedState.published[0]?.id ?? "";
    const { state: activated } = activatePublished(
      publishedState,
      firstPublishedId,
      "2026-01-01T00:00:01.000Z",
    );
    saveProfileLifecycle(activated);

    const reloaded = loadProfileLifecycle(profile.id);
    expect(reloaded.published).toHaveLength(2);
    expect(reloaded.draft?.name).toBe("House draft");
    expect(reloaded.revision).toBe(activated.revision);
  });

  it("migrates v5 state to the current version without discarding profiles", () => {
    const profile = createEmptyProfile("Legacy");
    const migrated = migrate({
      version: 5,
      profiles: [profile],
      profileHistory: { [profile.id]: [profile] },
      activeProfileId: profile.id,
      settings: {},
    });

    expect(migrated.version).toBe(CURRENT_STATE_VERSION);
    expect(migrated.profiles).toHaveLength(1);
    expect(migrated.profileLifecycles[profile.id]?.published).toHaveLength(1);
    expect(migrated.profileLifecycles[profile.id]?.draft).toBeNull();
  });

  it("rejects a corrupt lifecycle without failing the whole load", () => {
    const profile = createEmptyProfile("Corrupt");
    const migrated = migrate({
      version: CURRENT_STATE_VERSION,
      profiles: [profile],
      profileHistory: { [profile.id]: [profile] },
      profileLifecycles: { [profile.id]: { profileId: profile.id, published: "nope" } },
      settings: {},
    });

    expect(migrated.profiles).toHaveLength(1);
    expect(migrated.profileLifecycles[profile.id]?.published).toHaveLength(1);
  });
});
