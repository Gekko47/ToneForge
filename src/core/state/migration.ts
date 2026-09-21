/**
 * State schema migrations keyed by version.
 * Kept in code so future schema changes are explicit and testable.
 */

import { z } from "zod";
import { StyleProfileSchema, type StyleProfile } from "../domain/StyleProfile";
import { type PersistedState } from "./persistence";

export const CURRENT_STATE_VERSION = 2;

const DEFAULT_SETTINGS: PersistedState["settings"] = {
  telemetryDisabled: true,
};

/**
 * Migrate an unknown persisted state to the current schema version.
 * Returns a default state when the input is unparseable or too old.
 */
export function migrate(raw: unknown): PersistedState {
  if (raw === null || raw === undefined) {
    return defaultState();
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return defaultState();
  }

  const obj = raw as Record<string, unknown>;
  const version = typeof obj.version === "number" ? obj.version : 0;

  switch (version) {
    case 0:
      return migrateV0ToCurrent(obj);
    case 1:
      return migrateV1ToV2(obj);
    case CURRENT_STATE_VERSION:
      return readCurrentState(obj);
    default:
      return defaultState();
  }
}

function defaultState(): PersistedState {
  return {
    version: CURRENT_STATE_VERSION,
    profiles: [],
    profileHistory: {},
    activeProfileId: null,
    settings: { ...DEFAULT_SETTINGS },
  };
}

function readCurrentState(obj: Record<string, unknown>): PersistedState {
  const profiles = normalizeProfiles(obj.profiles);
  return {
    version: CURRENT_STATE_VERSION,
    profiles,
    profileHistory: normalizeProfileHistory(obj.profileHistory, profiles),
    activeProfileId: normalizeActiveProfileId(obj.activeProfileId, profiles),
    settings: normalizeSettings(obj.settings),
  };
}

/** v0 had no `version` field; normalize it to the current schema. */
function migrateV0ToCurrent(raw: Record<string, unknown>): PersistedState {
  const profiles = normalizeProfiles(raw.profiles);
  return {
    version: CURRENT_STATE_VERSION,
    profiles,
    profileHistory: normalizeProfileHistory(raw.profileHistory, profiles),
    activeProfileId: normalizeActiveProfileId(raw.activeProfileId, profiles),
    settings: normalizeSettings(raw.settings),
  };
}

function migrateV1ToV2(raw: Record<string, unknown>): PersistedState {
  const profiles = normalizeProfiles(raw.profiles);
  return {
    version: CURRENT_STATE_VERSION,
    profiles,
    profileHistory: normalizeProfileHistory(raw.profileHistory, profiles),
    activeProfileId: normalizeActiveProfileId(raw.activeProfileId, profiles),
    settings: normalizeSettings(raw.settings),
  };
}

function normalizeProfiles(raw: unknown): StyleProfile[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((snapshot) => StyleProfileSchema.safeParse(snapshot))
    .filter((result): result is { success: true; data: StyleProfile } => result.success)
    .map((result) => result.data);
}

function normalizeActiveProfileId(raw: unknown, profiles: readonly StyleProfile[]): string | null {
  if (typeof raw !== "string" || !profiles.some((profile) => profile.id === raw)) {
    return null;
  }
  return raw;
}

function normalizeSettings(raw: unknown): PersistedState["settings"] {
  const parsed = z.record(z.string(), z.unknown()).safeParse(raw);
  if (!parsed.success) {
    return { ...DEFAULT_SETTINGS };
  }
  return {
    ...DEFAULT_SETTINGS,
    ...parsed.data,
  } as PersistedState["settings"];
}

function normalizeProfileHistory(
  raw: unknown,
  profiles: readonly StyleProfile[],
): PersistedState["profileHistory"] {
  const history: Record<string, StyleProfile[]> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    Object.entries(raw).forEach(([profileId, snapshots]) => {
      const idResult = z.string().uuid().safeParse(profileId);
      if (!idResult.success || !Array.isArray(snapshots)) {
        return;
      }
      const validSnapshots = snapshots
        .map((snapshot) => StyleProfileSchema.safeParse(snapshot))
        .filter(
          (result): result is { success: true; data: StyleProfile } =>
            result.success && result.data.id === profileId,
        )
        .map((result) => result.data);
      if (validSnapshots.length > 0) {
        history[profileId] = validSnapshots;
      }
    });
  }

  profiles.forEach((profile) => {
    if (!history[profile.id]) {
      history[profile.id] = [profile];
    }
  });
  return history;
}
