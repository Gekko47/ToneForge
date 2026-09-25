import {
  effectiveProfile,
  type ProfileRecord,
  type ProfileRevision,
} from "../domain/ProfileRecord";
import type { StyleProfile } from "../domain/StyleProfile";
import type { PersistedState } from "./persistence";

/**
 * Pure read-only views over `profileRecords`.
 *
 * These replace the deleted `profiles[]` and `profileHistory` fields. They
 * import no Office, LLM, or UI code, so they are unit testable directly and
 * cannot mutate persisted state.
 */

export interface ProfileSummary {
  id: string;
  name: string;
  /** Revision analysis currently uses: active published, else the draft. */
  revision: number;
  publishedCount: number;
  hasDraft: boolean;
}

/** Ordered list of records for pickers, newest activity first. */
export function selectRecordList(state: PersistedState): ProfileSummary[] {
  return Object.values(state.profileRecords)
    .map(selectRecordSummary)
    .sort((left, right) => right.revision - left.revision);
}

export function selectRecordSummary(record: ProfileRecord): ProfileSummary {
  const profile = effectiveProfile(record);
  return {
    id: record.id,
    name: record.name,
    revision: profile?.revision ?? 0,
    publishedCount: record.published.length,
    hasDraft: record.draft !== null,
  };
}

/** The effective profile per record, for callers that previously read `profiles`. */
export function selectAllProfiles(state: PersistedState): StyleProfile[] {
  return Object.values(state.profileRecords)
    .map(effectiveProfile)
    .filter((profile): profile is StyleProfile => profile !== null);
}

/**
 * The active profile, preferring `activeProfileId` and falling back to the
 * first record so a stored-but-unselected profile is still usable.
 */
export function selectActiveProfile(state: PersistedState): StyleProfile | null {
  const preferred = state.activeProfileId ? state.profileRecords[state.activeProfileId] : undefined;
  const record = preferred ?? Object.values(state.profileRecords)[0];
  return record ? effectiveProfile(record) : null;
}

/** The full audit trail for one profile, oldest revision first. */
export function selectRevisions(state: PersistedState, profileId: string): ProfileRevision[] {
  return state.profileRecords[profileId]?.revisions ?? [];
}
