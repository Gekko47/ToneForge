import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import {
  activatePublished,
  createRecord,
  newProfileId,
  publishDraft,
  updateDraft,
} from "../../../../src/core/domain/ProfileRecord";
import { CURRENT_STATE_VERSION, migrate } from "../../../../src/core/state/migration";
import { loadProfileRecord, saveProfileRecord } from "../../../../src/core/state/persistence";

const NOW = "2026-01-01T00:00:00.000Z";

function house(): ReturnType<typeof createRecord> {
  return createRecord(newProfileId(), "House", NOW, createEmptyProfile("House", 1));
}

function draftOf(record: ReturnType<typeof createRecord>) {
  const draft = record.draft;
  if (!draft) throw new Error("expected the record to have a draft");
  return draft;
}

describe("profile record persistence", () => {
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

  it("creates a record whose first revision is the creation", () => {
    const record = house();
    saveProfileRecord(record);

    const stored = loadProfileRecord(record.id);
    expect(stored?.name).toBe("House");
    expect(stored?.revisions).toHaveLength(1);
    expect(stored?.revisions[0]?.action).toBe("created");
    expect(stored?.draft?.revision).toBe(1);
  });

  it("round-trips a draft and an explicitly activated published revision", () => {
    const record = house();
    const withDraft = updateDraft(
      record,
      { ...draftOf(record), name: "House draft" },
      "2026-01-01T00:00:00.000Z",
    ).record;
    const published = publishDraft(withDraft, "2026-01-01T00:00:00.000Z").record;
    const firstPublished = published.published[0]?.revision;
    if (firstPublished === undefined) throw new Error("expected a published revision");
    const activated = activatePublished(
      published,
      firstPublished,
      "2026-01-01T00:00:01.000Z",
    ).record;
    saveProfileRecord(activated);

    const reloaded = loadProfileRecord(record.id);
    expect(reloaded?.published).toHaveLength(1);
    expect(reloaded?.activePublishedRevision).toBe(firstPublished);
    expect(reloaded?.revisions.map((r) => r.action)).toEqual([
      "created",
      "draft-updated",
      "published",
      "activated",
    ]);
  });

  it("publishes on its own revision and activates it automatically", () => {
    const record = house();
    const published = publishDraft(record, NOW).record;
    saveProfileRecord(published);

    const reloaded = loadProfileRecord(record.id);
    // Publishing consumes a fresh number, so the trail stays unique.
    expect(reloaded?.published).toHaveLength(1);
    expect(reloaded?.published[0]?.revision).toBe(2);
    expect(reloaded?.activePublishedRevision).toBe(2);
    expect(reloaded?.draft?.revision).toBe(2);
    expect(reloaded?.revisions.map((r) => r.revision)).toEqual([1, 2]);
    expect(reloaded?.revisions[1]?.action).toBe("published");
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
    const record = migrated.profileRecords[profile.id];
    expect(record).toBeDefined();
    // One stored profile with no approval trail: published owns revision 1 and
    // the edit trail continues at 2.
    expect(record?.published).toHaveLength(1);
    expect(record?.revisions.map((r) => r.revision)).toEqual([2]);
  });

  it("folds both the v6 edit trail and approval trail into one record", () => {
    const first = createEmptyProfile("House", 1);
    const second = { ...first, name: "House renamed" };
    const approved = { ...first, name: "House approved" };

    const migrated = migrate({
      version: 6,
      profiles: [first],
      profileHistory: { [first.id]: [first, second] },
      profileLifecycles: { [first.id]: { published: [approved] } },
      settings: {},
    });

    const record = migrated.profileRecords[first.id];
    expect(record?.published).toHaveLength(1);
    expect(record?.published[0]?.profile.name).toBe("House approved");
    expect(record?.published[0]?.revision).toBe(1);
    // Published owns revision 1, so the edit trail continues from 2.
    expect(record?.revisions.map((r) => r.revision)).toEqual([2, 3]);
  });

  it("rejects a corrupt record without failing the whole load", () => {
    const profile = createEmptyProfile("Corrupt");
    const migrated = migrate({
      version: 6,
      profiles: [profile],
      profileHistory: { [profile.id]: [profile] },
      profileLifecycles: { [profile.id]: { published: "nope" } },
      settings: {},
    });

    expect(migrated.profileRecords[profile.id]?.published).toHaveLength(1);
  });
});
