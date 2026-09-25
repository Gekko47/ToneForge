import { describe, expect, it } from "vitest";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import {
  activatePublished,
  createRecord,
  discardDraft,
  effectiveProfile,
  newProfileId,
  publishDraft,
  REVISION_RETENTION_CAP,
  restoreAsDraft,
  updateDraft,
  type ProfileRecord,
} from "../../../../src/core/domain/ProfileRecord";

const STAMP = "2026-01-01T00:00:00.000Z";

function recordWithDraft(): ProfileRecord {
  const id = newProfileId();
  return createRecord(id, "House", STAMP, createEmptyProfile("House"));
}

/** The draft must exist for these transitions; assert rather than cast. */
function draftOf(record: ProfileRecord) {
  const draft = record.draft;
  if (!draft) throw new Error("expected the record to have a draft");
  return draft;
}

function rename(record: ProfileRecord, name: string): ProfileRecord {
  return updateDraft(record, { ...draftOf(record), name }, STAMP).record;
}

describe("ProfileRecord", () => {
  it("records the creation as revision 1 and seeds the draft", () => {
    const record = recordWithDraft();

    expect(record.revisions).toHaveLength(1);
    expect(record.revisions[0]).toMatchObject({ revision: 1, action: "created" });
    expect(record.draft?.revision).toBe(1);
    expect(record.nextRevision).toBe(2);
  });

  it("assigns a monotonic revision on every draft save and never reuses a number", () => {
    let record = recordWithDraft();
    const seen: number[] = [];

    Array.from({ length: 5 }, (_unused, index) => index).forEach((index) => {
      const result = updateDraft(record, { ...draftOf(record), name: `House ${index}` }, STAMP);
      record = result.record;
      seen.push(result.revision.revision);
    });

    expect(seen).toEqual([2, 3, 4, 5, 6]);
    expect(record.revisions.map((entry) => entry.revision)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(record.draft?.name).toBe("House 4");
  });

  it("publishes immutably: activating an older version never mutates published", () => {
    let record = rename(recordWithDraft(), "First publish");
    record = publishDraft(record, STAMP).record;
    const firstRevision = record.published[0]?.revision ?? 0;

    record = rename(record, "Second publish");
    record = publishDraft(record, STAMP).record;
    expect(record.published).toHaveLength(2);

    const activated = activatePublished(record, firstRevision, STAMP).record;

    expect(activated.activePublishedRevision).toBe(firstRevision);
    expect(activated.published).toHaveLength(2);
    expect(activated.published[0]?.profile.name).toBe("First publish");
    expect(activated.published[1]?.profile.name).toBe("Second publish");
    expect(effectiveProfile(activated)?.name).toBe("First publish");
  });

  it("restores a published version as a new draft without touching published", () => {
    let record = publishDraft(recordWithDraft(), STAMP).record;
    const publishedRevision = record.published[0]?.revision ?? 0;
    record = rename(record, "Work in progress");

    const restored = restoreAsDraft(record, publishedRevision, STAMP).record;

    expect(restored.draft?.name).toBe("House");
    expect(restored.draft?.revision).toBeGreaterThan(publishedRevision);
    expect(restored.published).toEqual(record.published);
  });

  it("records a discard so the trail stays complete", () => {
    const record = rename(recordWithDraft(), "Doomed");
    const before = record.revisions.length;

    const discarded = discardDraft(record, STAMP).record;

    expect(discarded.draft).toBeNull();
    expect(discarded.revisions).toHaveLength(before + 1);
    expect(discarded.revisions[discarded.revisions.length - 1]?.action).toBe("draft-discarded");
  });

  it("refuses to publish or discard without a draft", () => {
    const empty = createRecord(newProfileId(), "Empty", STAMP);

    expect(() => publishDraft(empty, STAMP)).toThrow("Cannot publish a profile without a draft");
    expect(() => discardDraft(empty, STAMP)).toThrow("Cannot discard a profile without a draft");
    expect(() => activatePublished(empty, 1, STAMP)).toThrow("is unknown");
    expect(() => restoreAsDraft(empty, 1, STAMP)).toThrow("is unknown");
  });

  it("caps the audit trail at the newest 20 while keeping every published revision", () => {
    // Publish first so revision 1 is protected by the published list.
    let record = publishDraft(recordWithDraft(), STAMP).record;
    Array.from({ length: REVISION_RETENTION_CAP + 10 }, (_unused, index) => index).forEach(
      (index) => {
        record = rename(record, `r${index}`);
      },
    );

    const numbers = record.revisions.map((entry) => entry.revision);
    const publishedNumbers = record.published.map((entry) => entry.revision);

    // 20 recent entries, plus any older revision that is still published.
    expect(record.revisions.length).toBeLessThanOrEqual(REVISION_RETENTION_CAP + 1);
    publishedNumbers.forEach((revision) => {
      expect(numbers).toContain(revision);
    });
    expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
  });

  it("keeps revision numbers unique as the trail is trimmed", () => {
    let record = recordWithDraft();
    Array.from({ length: REVISION_RETENTION_CAP + 5 }, (_unused, index) => index).forEach(
      (index) => {
        record = rename(record, `r${index}`);
      },
    );
    const once = record.revisions.length;
    const twice = rename(record, "after-trim").revisions.length;

    expect(once).toBeLessThanOrEqual(REVISION_RETENTION_CAP + 1);
    expect(twice).toBeLessThanOrEqual(REVISION_RETENTION_CAP + 1);
    expect(new Set(record.revisions.map((entry) => entry.revision)).size).toBe(
      record.revisions.length,
    );
  });
});
