import {
  effectiveProfile,
  type ProfileRecord,
  type ProfileRevision,
} from "../domain/ProfileRecord";
import type { GovernanceProfile } from "../domain/GovernanceProfile";
import type { ProfileKind, StyleProfile } from "../domain/StyleProfile";
import type { PersistedState } from "./persistence";

/**
 * Pure read-only views over the two profile namespaces.
 *
 * These replace the deleted `profiles[]` and `profileHistory` fields. They
 * import no Office, LLM, or UI code, so they are unit testable directly and
 * cannot mutate persisted state.
 *
 * Deterministic and semantic profiles are stored in two separate maps. Every
 * read therefore states which half it wants, and a caller that forgets cannot
 * silently receive the wrong one: handing a semantic profile to the rules
 * engine would apply AI-derived tone settings through a deterministic check.
 *
 * The two private helpers are declared before their callers on purpose. This
 * module and `persistence.ts` import each other's types, so a declaration used
 * above its definition can resolve to an uninitialised binding under the
 * CommonJS interop the build uses.
 */

export interface ProfileSummary {
  id: string;
  name: string;
  /** Revision analysis currently uses: active published, else the draft. */
  revision: number;
  publishedCount: number;
  hasDraft: boolean;
}

/** The records of one kind, in whichever namespace holds them. */
function recordsOf(state: PersistedState, kind: ProfileKind): Record<string, ProfileRecord> {
  return kind === "semantic" ? state.semanticProfileRecords : state.profileRecords;
}

function activeIdOf(state: PersistedState, kind: ProfileKind): string | null {
  return kind === "semantic" ? state.activeSemanticProfileId : state.activeProfileId;
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

/** Ordered list of records of one kind, for pickers, newest activity first. */
export function selectKindRecordList(
  state: PersistedState,
  kind: ProfileKind,
): ProfileSummary[] {
  return Object.entries(recordsOf(state, kind))
    .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
    .map(([, record]) => selectRecordSummary(record));
}

/** The effective profile per record of one kind. */
export function selectAllProfiles(
  state: PersistedState,
  kind: ProfileKind = "deterministic",
): StyleProfile[] {
  return Object.values(recordsOf(state, kind))
    .map((record) => effectiveProfile(record))
    .filter((profile): profile is StyleProfile => profile !== null);
}

/**
 * The active profile of one kind, preferring the stored active id and falling
 * back to the first record of that kind.
 *
 * The fallback searches **only** the requested namespace. Falling back across
 * both would hand a semantic profile to the deterministic review, or a
 * typography-only profile to the paragraph rewrite.
 */
export function selectActiveProfile(
  state: PersistedState,
  kind: ProfileKind = "deterministic",
): StyleProfile | null {
  const records = recordsOf(state, kind);
  const activeId = activeIdOf(state, kind);
  const preferred = activeId ? records[activeId] : undefined;
  const record = preferred ?? Object.values(records)[0];
  return record ? effectiveProfile(record) : null;
}

/**
 * The active record of one kind, or null.
 *
 * Callers that need the record rather than its effective profile — the profile
 * editor and the revision trail — must not go through `selectActiveProfile`,
 * which returns the published version and would hide the draft they are editing.
 */
export function selectActiveRecord(
  state: PersistedState,
  kind: ProfileKind = "deterministic",
): ProfileRecord | null {
  const records = recordsOf(state, kind);
  const activeId = activeIdOf(state, kind);
  return (activeId ? records[activeId] : undefined) ?? Object.values(records)[0] ?? null;
}

/**
 * Ordered list of the deterministic records.
 *
 * A named alias rather than a default argument, so the common call site reads
 * as the deterministic case rather than relying on a default to say so.
 */
export function selectRecordList(state: PersistedState): ProfileSummary[] {
  return selectKindRecordList(state, "deterministic");
}

/** The full audit trail for one deterministic profile, oldest revision first. */
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
