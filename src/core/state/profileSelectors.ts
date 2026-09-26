import {
  effectiveProfile,
  type ProfileRecord,
  type ProfileRevision,
} from "../domain/ProfileRecord";
import type { GovernanceProfile } from "../domain/GovernanceProfile";
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
  return Object.entries(state.profileRecords)
    .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
    .map(([, record]) => selectRecordSummary(record));
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

/**
 * The governance policy governing a style profile, or null when none is stored.
 *
 * Keyed by the same id as the record. `saveProfileRecord` seeds one for every
 * record, so a null here means the record was never saved rather than that
 * policy is absent — a caller must handle the null as "no policy yet" and not
 * as "policy that permits everything".
 */
export function selectGovernancePolicy(
  state: PersistedState,
  styleProfileId: string,
): GovernanceProfile | null {
  return state.governanceProfiles[styleProfileId] ?? null;
}

/** Every version of a policy, oldest first, for the policy history view. */
export function selectGovernanceHistory(
  state: PersistedState,
  styleProfileId: string,
): GovernanceProfile[] {
  return state.governanceHistory[styleProfileId] ?? [];
}
