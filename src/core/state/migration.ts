/**
 * State schema migrations keyed by version.
 * Kept in code so future schema changes are explicit and testable.
 */

import { type PersistedState } from "./persistence";

export const CURRENT_STATE_VERSION = 1;

export function migrate(raw: unknown): PersistedState {
  // v1 is the baseline schema; future versions add a `version` field and
  // transform functions here. For now we just parse via the caller.
  return raw as PersistedState;
}
