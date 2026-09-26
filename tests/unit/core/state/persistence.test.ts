import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createEmptyProfile } from "../../../../src/core/domain/index";
import { createRecord, newProfileId, updateDraft } from "../../../../src/core/domain/ProfileRecord";
import {
  createProfileRecord,
  loadProfileRecord,
  loadState,
  removeProfile,
  saveProfileRecord,
  setActiveProfile,
  saveState,
} from "../../../../src/core/state/index";

const NOW = "2026-01-01T00:00:00.000Z";

function record(name: string) {
  return createRecord(newProfileId(), name, NOW, createEmptyProfile(name, 1));
}

function draftOf(rec: ReturnType<typeof record>) {
  const draft = rec.draft;
  if (!draft) throw new Error("expected the record to have a draft");
  return draft;
}

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
      version: 7,
      profileRecords: {},
      activeProfileId: null,
      settings: {
        llmProvider: "mock",
        openAiCredentialMode: "broker",
        spotReviewConsent: false,
        fullDocumentReviewConsent: false,
        consistencyReviewConsent: false,
        semanticOptIn: false,
        telemetryDisabled: false,
      },
      governanceProfiles: {},
      governanceHistory: {},
      activeGovernanceProfileId: null,
    });

    expect(loadState().settings.telemetryDisabled).toBe(false);
    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();
  });

  it("round-trips a record with its initial governance profile and history", () => {
    const rec = record("Saved");
    saveProfileRecord(rec);
    const state = loadState();
    expect(Object.keys(state.profileRecords)).toEqual([rec.id]);
    expect(state.profileRecords[rec.id]?.name).toBe("Saved");
    expect(state.profileRecords[rec.id]?.revisions).toHaveLength(1);
    expect(state.governanceProfiles[rec.id]?.id).toBe(rec.id);
    expect(state.governanceProfiles[rec.id]?.style).toEqual(draftOf(rec));
    expect(state.governanceHistory[rec.id]).toEqual([state.governanceProfiles[rec.id]]);
  });

  it("saves in place rather than duplicating and appends a governance snapshot", () => {
    const rec = record("Dup");
    saveProfileRecord(rec);
    const updated = updateDraft(rec, { ...draftOf(rec), name: "Dup Updated" }, NOW);
    saveProfileRecord(updated.record);
    const state = loadState();
    expect(Object.keys(state.profileRecords)).toHaveLength(1);
    expect(state.profileRecords[rec.id]?.draft?.name).toBe("Dup Updated");
    expect(state.profileRecords[rec.id]?.revisions).toHaveLength(2);
    expect(state.governanceHistory[rec.id]).toHaveLength(2);
  });

  it("removes a record, its governance profile, and its history", () => {
    const rec = record("ToRemove");
    saveProfileRecord(rec);
    saveProfileRecord(updateDraft(rec, { ...draftOf(rec), name: "ToRemove Updated" }, NOW).record);
    removeProfile(rec.id);
    const state = loadState();
    expect(state.profileRecords[rec.id]).toBeUndefined();
    expect(state.governanceProfiles[rec.id]).toBeUndefined();
    expect(state.governanceHistory[rec.id]).toBeUndefined();
  });

  it("clears the active id when the active record is removed", () => {
    const rec = record("Active");
    saveProfileRecord(rec);
    setActiveProfile(rec.id);
    removeProfile(rec.id);
    expect(loadState().activeProfileId).toBeNull();
  });

  it("sets and clears the active profile id", () => {
    const rec = record("Active");
    saveProfileRecord(rec);
    setActiveProfile(rec.id);
    expect(loadState().activeProfileId).toBe(rec.id);
    setActiveProfile(null);
    expect(loadState().activeProfileId).toBeNull();
  });

  it("records each saved draft as a new revision", () => {
    const rec = record("Revisioned");
    saveProfileRecord(rec);
    const updated = updateDraft(rec, { ...draftOf(rec), name: "Revisioned Again" }, NOW);
    saveProfileRecord(updated.record);
    const state = loadState();
    expect(updated.revision.revision).toBe(2);
    expect(state.profileRecords[rec.id]?.draft?.revision).toBe(2);
    expect(state.profileRecords[rec.id]?.revisions.map((r) => r.revision)).toEqual([1, 2]);
  });

  it("creates and persists a new record on demand", () => {
    const created = createProfileRecord("Learned", NOW, createEmptyProfile("Learned", 1));
    expect(loadProfileRecord(created.id)?.name).toBe("Learned");
    expect(loadProfileRecord("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
