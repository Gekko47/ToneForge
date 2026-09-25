/**
 * State schema migrations keyed by version.
 * Kept in code so future schema changes are explicit and testable.
 */

import { z } from "zod";
import { StyleProfileSchema, type StyleProfile } from "../domain/StyleProfile";
import { GovernanceProfileSchema, type GovernanceProfile } from "../domain/GovernanceProfile";
import { type PersistedState } from "./persistence";

export const CURRENT_STATE_VERSION = 5;

const DEFAULT_SETTINGS: PersistedState["settings"] = {
  llmProvider: "mock",
  openAiCredentialMode: "broker",
  spotReviewConsent: false,
  fullDocumentReviewConsent: false,
  telemetryDisabled: true,
  semanticOptIn: false,
};

const DEFAULT_GOVERNANCE_PROFILES: Record<string, GovernanceProfile> = {};
const DEFAULT_GOVERNANCE_HISTORY: Record<string, GovernanceProfile[]> = {};

/** Create a minimal governance profile from a StyleProfile for migration seeding. */
function seedGovernanceProfile(style: StyleProfile): GovernanceProfile {
  const now = new Date().toISOString();
  return GovernanceProfileSchema.parse({
    id: style.id,
    version: 1,
    style,
    rules: [],
    terminology: {},
    scope: {},
    protection: {},
    editorial: {},
    provenance: {
      createdAt: now,
      createdBy: "migration",
      lineage: [],
    },
  });
}

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
    case 2:
      return migrateV3ToV4(obj);
    case 3:
    case 4:
      return migrateV3ToV4(obj);
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
    governanceProfiles: DEFAULT_GOVERNANCE_PROFILES,
    governanceHistory: DEFAULT_GOVERNANCE_HISTORY,
    activeGovernanceProfileId: null,
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
    governanceProfiles: normalizeGovernanceProfiles(obj.governanceProfiles),
    governanceHistory: normalizeGovernanceHistory(obj.governanceHistory, obj.governanceProfiles),
    activeGovernanceProfileId: normalizeActiveGovernanceProfileId(obj.activeGovernanceProfileId),
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
    governanceProfiles: DEFAULT_GOVERNANCE_PROFILES,
    governanceHistory: DEFAULT_GOVERNANCE_HISTORY,
    activeGovernanceProfileId: null,
    settings: normalizeSettings(raw.settings),
  };
}

function normalizeGovernanceHistory(
  raw: unknown,
  profiles: unknown,
): Record<string, GovernanceProfile[]> {
  const normalizedProfiles = normalizeGovernanceProfiles(profiles);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return Object.fromEntries(
      Object.entries(normalizedProfiles).map(([id, profile]) => [id, [profile]]),
    );
  }
  const result: Record<string, GovernanceProfile[]> = {};
  for (const [id, snapshots] of Object.entries(raw as Record<string, unknown>)) {
    if (!z.string().uuid().safeParse(id).success || !Array.isArray(snapshots)) continue;
    const valid = snapshots
      .map((snapshot) => GovernanceProfileSchema.safeParse(snapshot))
      .filter(
        (entry): entry is { success: true; data: GovernanceProfile } =>
          entry.success && entry.data.id === id,
      )
      .map((entry) => entry.data);
    if (valid.length > 0) result[id] = valid;
  }
  for (const [id, profile] of Object.entries(normalizedProfiles)) {
    if (!result[id]) result[id] = [profile];
  }
  return result;
}

function normalizeGovernanceProfiles(raw: unknown): Record<string, GovernanceProfile> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_GOVERNANCE_PROFILES;
  }
  const result: Record<string, GovernanceProfile> = {};
  for (const [id, profile] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = GovernanceProfileSchema.safeParse(profile);
    if (parsed.success) {
      result[id] = parsed.data;
    }
  }
  return result;
}

function normalizeActiveGovernanceProfileId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return raw;
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

/** v3/v4 to v5: remove credentials and seed governance-policy history. */
function migrateV3ToV4(raw: Record<string, unknown>): PersistedState {
  const state = normalizeV3State(raw);
  return {
    ...state,
    version: CURRENT_STATE_VERSION,
    settings: {
      ...state.settings,
      openAiCredentialMode: "broker",
    },
  };
}

function normalizeV3State(raw: Record<string, unknown>): PersistedState {
  const profiles = normalizeProfiles(raw.profiles);
  const activeProfileId = normalizeActiveProfileId(raw.activeProfileId, profiles);
  const governanceProfiles =
    Object.keys(raw.governanceProfiles ?? {}).length > 0
      ? normalizeGovernanceProfiles(raw.governanceProfiles)
      : Object.keys(DEFAULT_GOVERNANCE_PROFILES).length > 0
        ? DEFAULT_GOVERNANCE_PROFILES
        : seedGovernanceProfiles(activeProfileId, profiles);
  return {
    version: 3,
    profiles,
    profileHistory: normalizeProfileHistory(raw.profileHistory, profiles),
    activeProfileId,
    governanceProfiles,
    governanceHistory: normalizeGovernanceHistory(raw.governanceHistory, governanceProfiles),
    activeGovernanceProfileId:
      normalizeActiveGovernanceProfileId(raw.activeGovernanceProfileId) ??
      Object.keys(governanceProfiles)[0] ??
      null,
    settings: normalizeSettings(raw.settings),
  };
}

function seedGovernanceProfiles(
  activeProfileId: string | null,
  profiles: readonly StyleProfile[],
): Record<string, GovernanceProfile> {
  if (!activeProfileId) return {};
  const profile = profiles.find((candidate) => candidate.id === activeProfileId);
  return profile ? { [profile.id]: seedGovernanceProfile(profile) } : {};
}

function normalizeSettings(raw: unknown): PersistedState["settings"] {
  const parsed = z.record(z.string(), z.unknown()).safeParse(raw);
  if (!parsed.success) return { ...DEFAULT_SETTINGS };
  const { openAiApiKey: _removedCredential, ...safeSettings } = parsed.data;
  return {
    ...DEFAULT_SETTINGS,
    ...safeSettings,
    openAiCredentialMode: "broker",
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
