import { describe, expect, it } from "vitest";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import {
  createRecord,
  effectiveProfile,
  newProfileId,
  publishDraft,
  recallRevisionAsDraft,
  updateDraft,
} from "../../../../src/core/domain/ProfileRecord";

const STAMP = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";
const LATEST = "2026-01-03T00:00:00.000Z";

/** A created record with a draft and one audit entry, and no published version. */
function record() {
  return createRecord(newProfileId(), "House", STAMP, createEmptyProfile("House", 1));
}

function draftOf(rec: ReturnType<typeof record>) {
  const draft = rec.draft;
  if (!draft) throw new Error("expected the record to have a draft");
  return draft;
}

describe("recallRevisionAsDraft", () => {
  it("recalls a revision that was never published", () => {
    // The state that made recall impossible: a created record with zero
    // published versions, so `restoreAsDraft` had nothing to reach.
    const created = record();
    expect(created.published).toHaveLength(0);

    const edited = updateDraft(created, { ...draftOf(created), name: "House v2" }, LATER).record;

    const recalled = recallRevisionAsDraft(edited, 1, LATEST);
    // The earlier content is back, on a fresh revision number.
    expect(recalled.record.draft?.name).toBe("House");
    expect(recalled.record.draft?.revision).toBe(edited.nextRevision);
    expect(recalled.revision.detail).toMatch(/recalled as a draft/);
  });

  it("creates a draft without activating anything", () => {
    const published = publishDraft(record(), LATER).record;
    const activeBefore = published.activePublishedRevision;

    const recalled = recallRevisionAsDraft(published, 1, LATEST).record;

    // Documents are checked against the active published revision; a recall that
    // promoted an old snapshot would change that behind the user's back.
    expect(recalled.activePublishedRevision).toBe(activeBefore);
    expect(recalled.published).toEqual(published.published);
    expect(effectiveProfile(recalled)?.revision).toBe(activeBefore);
  });

  it("refuses a revision that is not in the audit trail", () => {
    expect(() => recallRevisionAsDraft(record(), 99, LATEST)).toThrow(
      /not in this record's audit trail/,
    );
  });

  it("round-trips a recalled draft through publish", () => {
    const recalled = recallRevisionAsDraft(record(), 1, LATER).record;
    const republished = publishDraft(recalled, LATEST).record;
    expect(republished.published).toHaveLength(1);
    expect(republished.activePublishedRevision).toBe(republished.published[0]?.revision);
  });
});
