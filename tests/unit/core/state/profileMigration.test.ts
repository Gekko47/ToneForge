import { describe, expect, it } from "vitest";
import { createEmptyProfile, type StyleProfile } from "../../../../src/core/domain/StyleProfile";
import { migrate, CURRENT_STATE_VERSION } from "../../../../src/core/state/migration";

/**
 * The v6 -> v7 fold is the only chance to preserve user data, so each case
 * asserts what survives rather than only that the load did not throw.
 */
describe("v6 to v7 profile consolidation", () => {
  it("folds the edit trail and the approval trail into one record", () => {
    const first = createEmptyProfile("House", 1);
    const second: StyleProfile = { ...first, name: "House edited" };
    const approved: StyleProfile = { ...first, name: "House approved" };

    const result = migrate({
      version: 6,
      profiles: [first],
      profileHistory: { [first.id]: [first, second] },
      profileLifecycles: { [first.id]: { published: [approved] } },
      activeProfileId: first.id,
      settings: {},
    });

    const record = result.profileRecords[first.id];
    expect(record).toBeDefined();
    // The approval trail becomes `published` and owns revisions 1..N.
    expect(record?.published).toHaveLength(1);
    expect(record?.published[0]?.profile.name).toBe("House approved");
    expect(record?.published[0]?.revision).toBe(1);
    // The edit trail continues from N+1 so no number is ever reused.
    expect(record?.revisions.map((r) => r.revision)).toEqual([2, 3]);
    expect(record?.revisions[0]?.profile.name).toBe("House");
    expect(record?.revisions[1]?.profile.name).toBe("House edited");
    expect(record?.revisions[0]?.action).toBe("created");
    expect(record?.revisions[1]?.action).toBe("draft-updated");
    // The draft is the latest edit, not the approved snapshot.
    expect(record?.draft?.name).toBe("House edited");
  });

  it("preserves the explicitly activated published version", () => {
    const first = createEmptyProfile("House", 1);
    const approvedOne: StyleProfile = { ...first, name: "Approved one" };
    const approvedTwo: StyleProfile = { ...first, name: "Approved two" };

    const result = migrate({
      version: 6,
      profiles: [first],
      profileLifecycles: {
        [first.id]: {
          published: [approvedOne, approvedTwo],
          activePublishedId: first.id,
        },
      },
      settings: {},
    });

    const record = result.profileRecords[first.id];
    // `activePublishedId` was a profile id; both snapshots share it, so the
    // first match wins and the migration never guesses a later one.
    expect(record?.activePublishedRevision).toBe(1);
    expect(record?.published).toHaveLength(2);
  });

  it("migrates a v5 profile with no lifecycle as published plus one edit", () => {
    const profile = createEmptyProfile("Legacy", 1);

    const result = migrate({
      version: 5,
      profiles: [profile],
      profileHistory: { [profile.id]: [profile] },
      activeProfileId: profile.id,
      settings: {},
    });

    const record = result.profileRecords[profile.id];
    // No approval trail, so the single stored profile becomes published
    // revision 1 and the edit trail continues at 2.
    expect(record?.published).toHaveLength(1);
    expect(record?.revisions.map((r) => r.revision)).toEqual([2]);
    expect(record?.nextRevision).toBe(3);
  });

  it("keeps every profile in a multi-profile state", () => {
    const house = createEmptyProfile("House", 1);
    const legal = createEmptyProfile("Legal", 1);
    const marketing = createEmptyProfile("Marketing", 1);

    const result = migrate({
      version: 6,
      profiles: [house, legal, marketing],
      profileHistory: {
        [house.id]: [house],
        [legal.id]: [legal],
        [marketing.id]: [marketing],
      },
      activeProfileId: legal.id,
      settings: {},
    });

    expect(Object.keys(result.profileRecords).sort()).toEqual(
      [house.id, legal.id, marketing.id].sort(),
    );
    expect(result.activeProfileId).toBe(legal.id);
  });

  it("discards only the corrupt record and keeps the healthy one", () => {
    const healthy = createEmptyProfile("Healthy", 1);
    const corrupt = createEmptyProfile("Corrupt", 1);

    const result = migrate({
      version: 6,
      profiles: [healthy, corrupt],
      profileHistory: { [corrupt.id]: [{ not: "a profile" }] },
      activeProfileId: healthy.id,
      settings: {},
    });

    expect(result.profileRecords[healthy.id]).toBeDefined();
    expect(result.profileRecords[corrupt.id]).toBeDefined();
    // The corrupt snapshot is dropped; the profile itself still exists.
    expect(result.profileRecords[corrupt.id]?.revisions).toHaveLength(1);
  });

  it("drops a v6 lifecycle that claims a published version for another profile", () => {
    const mine = createEmptyProfile("Mine", 1);
    const theirs = createEmptyProfile("Theirs", 1);

    const result = migrate({
      version: 6,
      profiles: [mine, theirs],
      profileLifecycles: { [mine.id]: { published: [theirs] } },
      settings: {},
    });

    // A snapshot carrying someone else's id is not part of this profile.
    expect(result.profileRecords[mine.id]?.published[0]?.profile.id).toBe(mine.id);
  });

  it("seeds a normative governance policy for every migrated record", () => {
    const profile = createEmptyProfile("Governed", 1);

    const result = migrate({
      version: 6,
      profiles: [profile],
      settings: {},
    });

    expect(result.governanceProfiles[profile.id]?.style.id).toBe(profile.id);
    expect(result.governanceHistory[profile.id]).toHaveLength(1);
  });

  it("is idempotent: re-migrating a v7 payload changes nothing", () => {
    const profile = createEmptyProfile("Stable", 1);
    const first = migrate({
      version: 6,
      profiles: [profile],
      profileHistory: { [profile.id]: [profile] },
      activeProfileId: profile.id,
      settings: {},
    });
    expect(first.version).toBe(CURRENT_STATE_VERSION);

    const second = migrate(JSON.parse(JSON.stringify(first)));
    expect(second.profileRecords).toEqual(first.profileRecords);
    expect(second.activeProfileId).toBe(first.activeProfileId);
  });
});
