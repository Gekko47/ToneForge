import { selectGovernancePolicy } from "../core/state/profileSelectors";
import { loadProfileRecord, loadState } from "../core/state/persistence";
import type { GovernanceProfile } from "../core/domain/GovernanceProfile";
import type { ProfileRecord } from "../core/domain/ProfileRecord";

export interface ActiveGovernanceContext {
  /** The active profile record, or null when no profile is active. */
  readonly record: ProfileRecord | null;
  /** The policy governing `record`, or null when there is no record to govern. */
  readonly policy: GovernanceProfile | null;
}

/**
 * Read the active record and the policy that governs it, together.
 *
 * Both the style tab and the governance-policy tab need this pair, and they
 * must not read it in two calls. A policy is selected *by* a record id, so
 * reading the state and the record separately can pair a freshly saved record
 * with the policy that belonged to the previous one — which is a real risk here
 * because `saveProfileRecord` rewrites the governance profile's wrapped style
 * and both pages re-read after a write.
 */
export function readActiveGovernanceContext(): ActiveGovernanceContext {
  const state = loadState();
  const record = state.activeProfileId === null ? null : loadProfileRecord(state.activeProfileId);
  return {
    record,
    policy: record === null ? null : selectGovernancePolicy(state, record.id),
  };
}
