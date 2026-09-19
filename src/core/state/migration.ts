/**
 * State schema migrations keyed by version.
 * Kept in code so future schema changes are explicit and testable.
 */

import { type PersistedState } from "./persistence";

export const CURRENT_STATE_VERSION = 1;

const DEFAULT_SETTINGS: PersistedState["settings"] = {
  telemetryDisabled: true,
};

/**
 * Migrate an unknown persisted state to the current schema version.
 * Returns a default state when the input is unparseable or too old.
 */
export function migrate(raw: unknown): PersistedState {
  if (raw === null || raw === undefined) {
    return {
      version: CURRENT_STATE_VERSION,
      profiles: [],
      activeProfileId: null,
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      version: CURRENT_STATE_VERSION,
      profiles: [],
      activeProfileId: null,
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  const obj = raw as Record<string, unknown>;
  const version = typeof obj.version === "number" ? obj.version : 0;

  switch (version) {
    case 0:
      return migrateV0toV1(obj);
    case 1:
    default:
      return {
        version: CURRENT_STATE_VERSION,
        profiles: Array.isArray(obj.profiles) ? (obj.profiles as PersistedState["profiles"]) : [],
        activeProfileId:
          typeof obj.activeProfileId === "string" || obj.activeProfileId === null
            ? (obj.activeProfileId as string | null)
            : null,
        settings:
          obj.settings && typeof obj.settings === "object"
            ? { ...DEFAULT_SETTINGS, ...(obj.settings as Record<string, unknown>) }
            : { ...DEFAULT_SETTINGS },
      };
  }
}

/** v0 had no `version` field; add it and ensure defaults are present. */
function migrateV0toV1(raw: Record<string, unknown>): PersistedState {
  return {
    version: CURRENT_STATE_VERSION,
    profiles: Array.isArray(raw.profiles) ? (raw.profiles as PersistedState["profiles"]) : [],
    activeProfileId:
      typeof raw.activeProfileId === "string" || raw.activeProfileId === null
        ? (raw.activeProfileId as string | null)
        : null,
    settings:
      raw.settings && typeof raw.settings === "object"
        ? { ...DEFAULT_SETTINGS, ...(raw.settings as Record<string, unknown>) }
        : { ...DEFAULT_SETTINGS },
  };
}
