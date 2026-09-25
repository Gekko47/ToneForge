/**
 * Application state persistence.
 *
 * Primary store: Office roamingSettings (survives across sessions).
 * Fallback: localStorage (used when Office runtime is unavailable).
 * Credentials are not part of ordinary state. Legacy credential fields are
 * removed during migration and their legacy storage records are purged.
 */

import { z } from "zod";
import { logger } from "../../shared/utils/logger";
import { StyleProfileSchema, type StyleProfile } from "../domain/StyleProfile";
import {
  createGovernanceProfile,
  GovernanceProfileSchema,
  type GovernanceProfile,
} from "../domain/GovernanceProfile";
import {
  createDraft,
  createLifecycleState,
  ProfileLifecycleStateSchema,
  type ProfileLifecycleState,
} from "../domain/ProfileLifecycle";
import { CURRENT_STATE_VERSION, migrate } from "./migration";

const StateSchema = z.object({
  version: z.number().int().nonnegative().default(6),
  profiles: z.array(StyleProfileSchema).default([]),
  profileHistory: z.record(z.string().uuid(), z.array(StyleProfileSchema)).default({}),
  activeProfileId: z.string().uuid().nullable().default(null),
  governanceProfiles: z.record(z.string().uuid(), GovernanceProfileSchema).default({}),
  governanceHistory: z.record(z.string().uuid(), z.array(GovernanceProfileSchema)).default({}),
  activeGovernanceProfileId: z.string().uuid().nullable().default(null),
  profileLifecycles: z.record(z.string().uuid(), ProfileLifecycleStateSchema).default({}),
  settings: z
    .object({
      openAiBaseUrl: z.string().url().optional(),
      openAiModel: z.string().optional(),
      llmProvider: z.enum(["openai", "mock"]).default("mock"),
      openAiCredentialMode: z.literal("broker").default("broker"),
      spotReviewConsent: z.boolean().default(false),
      fullDocumentReviewConsent: z.boolean().default(false),
      telemetryDisabled: z.boolean().default(true),
      semanticOptIn: z.boolean().default(false),
    })
    .default({}),
});

export type PersistedState = z.infer<typeof StateSchema>;

const STORAGE_KEY = "ToneForge.State.v6";
const LEGACY_STORAGE_KEYS = [
  "ToneForge.State.v5",
  "ToneForge.State.v4",
  "ToneForge.State.v3",
  "ToneForge.State.v2",
  "ToneForge.State.v1",
] as const;

function isOfficeRuntime(): boolean {
  return typeof (globalThis as unknown as { Office?: unknown }).Office !== "undefined";
}

function parsePersistedValue(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getRoamingSettings(): Record<string, unknown> | null {
  if (!isOfficeRuntime()) return null;
  try {
    const office = (
      globalThis as unknown as {
        Office?: { roamingSettings?: { get: (k: string) => unknown } };
      }
    ).Office;
    const settings = office?.roamingSettings;
    if (!settings) return null;

    return (
      parsePersistedValue(settings.get(STORAGE_KEY)) ??
      LEGACY_STORAGE_KEYS.map((key) => parsePersistedValue(settings.get(key))).find(
        (value) => value !== null,
      ) ??
      null
    );
  } catch {
    return null;
  }
}

async function setRoamingSettingsAsync(value: Record<string, unknown>): Promise<void> {
  const office = (
    globalThis as unknown as {
      Office?: {
        roamingSettings?: {
          set: (k: string, v: unknown) => void;
          remove?: (k: string) => void;
          saveAsync: (cb?: (result: unknown) => void) => void;
        };
      };
    }
  ).Office;
  const settings = office?.roamingSettings;
  if (!settings) return;
  settings.set(STORAGE_KEY, JSON.stringify(value));
  LEGACY_STORAGE_KEYS.forEach((key) => settings.remove?.(key));
  await new Promise<void>((resolve) => {
    try {
      settings.saveAsync(() => resolve());
    } catch {
      resolve();
    }
  });
}

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length(): number {
      return store.size;
    },
  };
}

const memoryStorage = createMemoryStorage();

function getSafeStorage(): Storage {
  if (typeof window !== "undefined") {
    try {
      return window.localStorage ?? memoryStorage;
    } catch {
      return memoryStorage;
    }
  }

  // Do not probe Node's experimental global localStorage getter. Non-browser
  // callers still get a usable, process-local fallback.
  return memoryStorage;
}

function getLocalStorage(): Record<string, unknown> | null {
  const storage = getSafeStorage();
  try {
    return (
      parsePersistedValue(storage.getItem(STORAGE_KEY)) ??
      LEGACY_STORAGE_KEYS.map((key) => parsePersistedValue(storage.getItem(key))).find(
        (value) => value !== null,
      ) ??
      null
    );
  } catch {
    return null;
  }
}

function setLocalStorage(value: Record<string, unknown>): void {
  try {
    const storage = getSafeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(value));
    LEGACY_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
  } catch {
    // Storage may be unavailable or full; ignore silently.
  }
}

/**
 * Load persisted state.
 *
 * Raw persisted bytes are migrated to the current schema version BEFORE
 * validation, so legacy v0 and v1 state are upgraded instead of being
 * discarded as incompatible.
 */
export function loadState(): PersistedState {
  const raw = getRoamingSettings() ??
    getLocalStorage() ?? {
      version: CURRENT_STATE_VERSION,
      profiles: [],
      activeProfileId: null,
      settings: {},
    };

  // Migrate before parsing so versioned state upgrades are applied.
  const migrated = migrate(raw);

  try {
    const parsed = StateSchema.parse(migrated);
    if (
      rawContainsLegacyCredential(raw) ||
      (typeof raw.version === "number" && raw.version < CURRENT_STATE_VERSION) ||
      !Object.prototype.hasOwnProperty.call(raw, "governanceHistory") ||
      !Object.prototype.hasOwnProperty.call(raw, "profileLifecycles")
    ) {
      saveState(parsed);
    }
    return parsed;
  } catch (err) {
    // Corrupted or incompatible persisted state: fall back to defaults
    // rather than crashing the add-in. The previous value is unrecoverable.
    logger.warn("Failed to parse persisted state; falling back to defaults", {
      errorType: err instanceof Error ? err.name : "Unknown",
    });
    return migrate(null);
  }
}

/**
 * Save state. localStorage is written synchronously so callers can rely on
 * it. Office roamingSettings is persisted asynchronously via saveAsync;
 * failures are logged but never thrown.
 */
export function saveState(state: PersistedState): void {
  const parsed = StateSchema.parse(state);
  const payload = { ...parsed };

  // Always write localStorage synchronously.
  setLocalStorage(payload);

  // Persist to Office roamingSettings asynchronously (best-effort).
  if (isOfficeRuntime()) {
    setRoamingSettingsAsync(payload).catch((err: unknown) => {
      logger.error("Failed to persist to Office roamingSettings", {
        errorType: err instanceof Error ? err.name : "Unknown",
      });
    });
  }
}

/** Remove any legacy persisted credential and select the broker/mock-safe default. */
export function clearPersistedCredentials(): PersistedState {
  const state = loadState();
  const cleared: PersistedState = {
    ...state,
    settings: {
      ...state.settings,
      llmProvider: "mock",
      openAiCredentialMode: "broker",
    },
  };
  saveState(cleared);
  return cleared;
}

function rawContainsLegacyCredential(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const settings = (raw as Record<string, unknown>).settings;
  return (
    !!settings &&
    typeof settings === "object" &&
    !Array.isArray(settings) &&
    Object.prototype.hasOwnProperty.call(settings, "openAiApiKey")
  );
}

function sameSnapshot(left: StyleProfile, right: StyleProfile): boolean {
  return JSON.stringify({ ...left, updatedAt: "" }) === JSON.stringify({ ...right, updatedAt: "" });
}

function appendGovernanceSnapshot(
  history: readonly GovernanceProfile[],
  profile: GovernanceProfile,
): GovernanceProfile[] {
  const latest = history[history.length - 1];
  return latest && JSON.stringify(latest) === JSON.stringify(profile)
    ? [...history]
    : [...history, profile];
}

function appendSnapshot(history: readonly StyleProfile[], profile: StyleProfile): StyleProfile[] {
  const latest = history[history.length - 1];
  return latest && sameSnapshot(latest, profile) ? [...history] : [...history, profile];
}

export function upsertProfile(profile: StyleProfile): void {
  const state = loadState();
  const existingIndex = state.profiles.findIndex((item: StyleProfile) => item.id === profile.id);
  const history = state.profileHistory[profile.id] ?? [];
  const governance = state.governanceProfiles[profile.id];
  const governanceHistory = state.governanceHistory[profile.id] ?? (governance ? [governance] : []);

  if (existingIndex >= 0) {
    const current = state.profiles[existingIndex];
    if (!current) {
      state.profiles.push(profile);
      state.profileHistory[profile.id] = appendSnapshot(history, profile);
      saveState(state);
      return;
    }
    const historyWithCurrent = appendSnapshot(history, current);
    const updated = {
      ...current,
      ...profile,
      updatedAt: new Date().toISOString(),
    };
    state.profiles[existingIndex] = updated;
    state.profileHistory[profile.id] = appendSnapshot(historyWithCurrent, updated);
    if (governance) {
      const nextGovernance = GovernanceProfileSchema.parse({ ...governance, style: updated });
      state.governanceProfiles[profile.id] = nextGovernance;
      state.governanceHistory[profile.id] = appendGovernanceSnapshot(
        governanceHistory,
        nextGovernance,
      );
    }
  } else {
    state.profiles.push(profile);
    state.profileHistory[profile.id] = appendSnapshot(history, profile);
    const initialGovernance = GovernanceProfileSchema.parse({
      ...createGovernanceProfile(profile),
      id: profile.id,
    });
    state.governanceProfiles[profile.id] = initialGovernance;
    state.governanceHistory[profile.id] = [initialGovernance];
  }

  saveState(state);
}

export function removeProfile(id: string): void {
  const state = loadState();
  state.profiles = state.profiles.filter((item: StyleProfile) => item.id !== id);
  const nextHistory = { ...state.profileHistory };
  delete nextHistory[id];
  state.profileHistory = nextHistory;
  const nextGovernanceHistory = { ...state.governanceHistory };
  delete nextGovernanceHistory[id];
  state.governanceHistory = nextGovernanceHistory;
  const nextGovernanceProfiles = { ...state.governanceProfiles };
  delete nextGovernanceProfiles[id];
  state.governanceProfiles = nextGovernanceProfiles;
  if (state.activeProfileId === id) state.activeProfileId = null;
  if (state.activeGovernanceProfileId === id) state.activeGovernanceProfileId = null;
  saveState(state);
}

export function setActiveProfile(id: string | null): void {
  const state = loadState();
  state.activeProfileId = id;
  saveState(state);
}

/**
 * Persist a profile lifecycle. Published versions are immutable, so callers pass
 * the state produced by the lifecycle transition and never edit snapshots in
 * place.
 */
export function saveProfileLifecycle(lifecycle: ProfileLifecycleState): void {
  const state = loadState();
  state.profileLifecycles[lifecycle.profileId] = ProfileLifecycleStateSchema.parse(lifecycle);
  saveState(state);
}

/** Read a persisted lifecycle, falling back to a fresh one for a known profile. */
export function loadProfileLifecycle(
  profileId: string,
  seed?: StyleProfile,
): ProfileLifecycleState {
  const stored = loadState().profileLifecycles[profileId];
  if (stored) return stored;
  const state = createLifecycleState(profileId);
  return seed ? createDraft(state, { ...seed, id: profileId }, new Date().toISOString()) : state;
}
