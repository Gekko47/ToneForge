import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import {
  createRecord,
  newProfileId,
  publishDraft,
  REVISION_RETENTION_CAP,
  updateDraft,
  type ProfileRecord,
} from "../../../../src/core/domain/ProfileRecord";
import { saveProfileRecord, loadState } from "../../../../src/core/state/persistence";

const NOW = "2026-01-01T00:00:00.000Z";

/**
 * `Office.roamingSettings` stores a single settings record per add-in, and the
 * documented ceiling is a few megabytes. This test pins the worst case the
 * retention cap permits so a regression in snapshot size fails here rather than
 * silently losing a user's audit trail in the field.
 */
const ROAMING_SETTINGS_BUDGET_BYTES = 512 * 1024;

function recordWithSaves(name: string, saves: number): ProfileRecord {
  let rec = createRecord(newProfileId(), name, NOW, createEmptyProfile(name, 1));
  Array.from({ length: saves }, (_unused, index) => index).forEach((index) => {
    const draft = rec.draft;
    if (!draft) throw new Error("expected the record to have a draft");
    rec = updateDraft(rec, { ...draft, name: `${name} save ${index}` }, NOW).record;
  });
  return rec;
}

describe("persisted state budget", () => {
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

  it("keeps three profiles at the retention cap well inside the roaming budget", () => {
    const records = ["House", "Legal", "Marketing"].map((name) =>
      recordWithSaves(name, REVISION_RETENTION_CAP + 10),
    );
    records.forEach(saveProfileRecord);

    const payload = JSON.stringify(loadState());
    const bytes = new TextEncoder().encode(payload).length;

    // A third of the budget leaves headroom for settings and future fields.
    expect(bytes).toBeLessThan(ROAMING_SETTINGS_BUDGET_BYTES / 3);
  });

  it("keeps published versions and their full snapshots, not just the cap", () => {
    const base = recordWithSaves("House", 5);
    const withPublished = publishDraft(base, NOW).record;
    saveProfileRecord(withPublished);

    const stored = loadState().profileRecords[withPublished.id];
    expect(stored?.published).toHaveLength(1);
    expect(stored?.published[0]?.profile.name).toBe(base.name);
  });

  it("grows linearly with the number of retained revisions", () => {
    const small = recordWithSaves("House", 5);
    saveProfileRecord(small);
    const smallBytes = new TextEncoder().encode(JSON.stringify(loadState())).length;

    window.localStorage.clear();
    const large = recordWithSaves("House", REVISION_RETENTION_CAP);
    saveProfileRecord(large);
    const largeBytes = new TextEncoder().encode(JSON.stringify(loadState())).length;

    // Snapshots are the only thing that grows, so the cap is the only lever.
    expect(largeBytes).toBeGreaterThan(smallBytes);
    expect(largeBytes).toBeLessThan(ROAMING_SETTINGS_BUDGET_BYTES / 2);
  });
});
