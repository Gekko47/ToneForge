import { describe, expect, it } from "vitest";
import { createEmptyProfile, type StyleProfile } from "../../../../src/core/domain/StyleProfile";
import {
  activatePublished,
  createRecord,
  newProfileId,
  publishDraft,
  updateDraft,
  type ProfileRecord,
} from "../../../../src/core/domain/ProfileRecord";
import {
  selectActiveProfile,
  selectAllProfiles,
  selectRecordList,
  selectRecordSummary,
  selectRevisions,
} from "../../../../src/core/state/profileSelectors";
import { type PersistedState } from "../../../../src/core/state/persistence";

const STAMP = "2026-01-01T00:00:00.000Z";

/** A record with `saves` extra draft saves, so its revision is `saves + 1`. */
function record(name: string, saves = 0, updatedAt = STAMP): ProfileRecord {
  const id = newProfileId();
  let rec = createRecord(id, name, updatedAt, createEmptyProfile(name, 1));
  Array.from({ length: saves }, (_unused, index) => index).forEach(() => {
    const draft = rec.draft;
    if (!draft) throw new Error("expected the record to have a draft");
    rec = updateDraft(rec, { ...draft, name }, updatedAt).record;
  });
  return rec;
}

function state(records: ProfileRecord[], activeProfileId: string | null = null): PersistedState {
  return {
    version: 7,
    profileRecords: Object.fromEntries(records.map((r) => [r.id, r])),
    activeProfileId,
    governanceProfiles: {},
    governanceHistory: {},
    activeGovernanceProfileId: null,
    settings: {
      llmProvider: "mock",
      openAiCredentialMode: "broker",
      spotReviewConsent: false,
      fullDocumentReviewConsent: false,
      semanticOptIn: false,
      telemetryDisabled: true,
    },
  };
}

describe("profileSelectors", () => {
  it("summarises a record without exposing its snapshots", () => {
    const rec = record("House");
    const summary = selectRecordSummary(rec);

    expect(summary).toEqual({
      id: rec.id,
      name: "House",
      revision: 1,
      publishedCount: 0,
      hasDraft: true,
    });
  });

  it("orders the picker list by newest activity first", () => {
    // The lower-revision record was saved last, so activity order and revision
    // order disagree: the picker must follow the activity timestamp.
    const olderRevision = record("Older", 1, "2026-01-02T00:00:00.000Z");
    const newerRevision = record("Newer", 4, "2026-01-01T00:00:00.000Z");

    expect(selectRecordList(state([newerRevision, olderRevision])).map((s) => s.name)).toEqual([
      "Older",
      "Newer",
    ]);
  });

  it("returns the effective profile per record", () => {
    const first = record("First");
    const second = record("Second", 1);
    const profiles = selectAllProfiles(state([first, second]));

    expect(profiles.map((p) => p.name)).toEqual(["First", "Second"]);
  });

  it("prefers the explicitly active record", () => {
    const first = record("First");
    const second = record("Second");

    expect(selectActiveProfile(state([first, second], second.id))?.name).toBe("Second");
  });

  it("falls back to the first record when none is selected", () => {
    const first = record("First");
    const second = record("Second");

    expect(selectActiveProfile(state([first, second]))?.name).toBe("First");
  });

  it("ignores an active id that no longer has a record", () => {
    const first = record("First");

    expect(selectActiveProfile(state([first], newProfileId()))?.name).toBe("First");
  });

  it("returns null when there are no records at all", () => {
    expect(selectActiveProfile(state([]))).toBeNull();
    expect(selectAllProfiles(state([]))).toEqual([]);
    expect(selectRecordList(state([]))).toEqual([]);
  });

  it("prefers the active published version over the draft", () => {
    let rec = record("House");
    rec = publishDraft(rec, STAMP).record;
    const publishedRevision = rec.published[0]?.revision ?? 0;
    rec = activatePublished(rec, publishedRevision, STAMP).record;
    const edited: StyleProfile = { ...(rec.draft as StyleProfile), name: "House draft" };
    rec = { ...rec, draft: edited };

    const summary = selectRecordSummary(rec);
    expect(summary.publishedCount).toBe(1);
    expect(summary.hasDraft).toBe(true);
    // The active published snapshot still governs analysis.
    expect(summary.revision).toBe(publishedRevision);
  });

  it("returns an empty trail for an unknown profile rather than throwing", () => {
    expect(selectRevisions(state([record("House")]), newProfileId())).toEqual([]);
  });
});
