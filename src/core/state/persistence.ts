/**
 * Application state persistence.
 *
 * Primary store: Office roamingSettings (survives across sessions).
 * Fallback: localStorage (used when Office runtime is unavailable,
 * e.g. in unit tests or when running outside Word).
 *
 * NOTE: API keys are stored in plaintext in roamingSettings. This is an
 * accepted MVP limitation; Stage 25 should add DPPII/key-vault encryption.
 */

import { z } from "zod";
import { StyleProfileSchema, type StyleProfile } from "../domain/StyleProfile";
import { GovernanceProfileSchema } from "../domain/GovernanceProfile";
import { CURRENT_STATE_VERSION, migrate } from "./migration";

const StateSchema = z.object({
  version: z.number().int().nonnegative().default(3),
  profiles: z.array(StyleProfileSchema).default([]),
  profileHistory: z.record(z.string().uuid(), z.array(StyleProfileSchema)).default({}),
  activeProfileId: z.string().uuid().nullable().default(null),
  governanceProfiles: z.record(z.string().uuid(), GovernanceProfileSchema).default({}),
  activeGovernanceProfileId: z.string().uuid().nullable().default(null),
  settings: z
    .object({
      openAiApiKey: z.string().optional(),
      openAiBaseUrl: z.string().url().optional(),
      openAiModel: z.string().optional(),
      llmProvider: z.enum(["openai", "mock"]).default("mock"),
      spotReviewConsent: z.boolean().default(false),
      fullDocumentReviewConsent: z.boolean().default(false),
      telemetryDisabled: z.boolean().default(true),
      semanticOptIn: z.boolean().default(false),
    })
    .default({}),
});

export type PersistedState = z.infer<typeof StateSchema>;

const STORAGE_KEY = "ToneForge.State.v3";
const LEGACY_STORAGE_KEY_V2 = "ToneForge.State.v2";
const LEGACY_STORAGE_KEY_V1 = "ToneForge.State.v1";

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
      parsePersistedValue(settings.get(LEGACY_STORAGE_KEY_V2)) ??
      parsePersistedValue(settings.get(LEGACY_STORAGE_KEY_V1))
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
          saveAsync: (cb?: (result: unknown) => void) => void;
        };
      };
    }
  ).Office;
  const settings = office?.roamingSettings;
  if (!settings) return;
  settings.set(STORAGE_KEY, JSON.stringify(value));
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
      parsePersistedValue(storage.getItem(LEGACY_STORAGE_KEY_V2)) ??
      parsePersistedValue(storage.getItem(LEGACY_STORAGE_KEY_V1))
    );
  } catch {
    return null;
  }
}

function setLocalStorage(value: Record<string, unknown>): void {
  try {
    getSafeStorage().setItem(STORAGE_KEY, JSON.stringify(value));
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
    return StateSchema.parse(migrated);
  } catch (err) {
    // Corrupted or incompatible persisted state: fall back to defaults
    // rather than crashing the add-in. The previous value is unrecoverable.
    console.warn(
      "Failed to parse persisted state; falling back to defaults:",
      err instanceof Error ? err.message : String(err),
    );
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
      console.error(
        "Failed to persist to Office roamingSettings:",
        err instanceof Error ? err.message : String(err),
      );
    });
  }
}

function sameSnapshot(left: StyleProfile, right: StyleProfile): boolean {
  return JSON.stringify({ ...left, updatedAt: "" }) === JSON.stringify({ ...right, updatedAt: "" });
}

function appendSnapshot(history: readonly StyleProfile[], profile: StyleProfile): StyleProfile[] {
  const latest = history[history.length - 1];
  return latest && sameSnapshot(latest, profile) ? [...history] : [...history, profile];
}

export function upsertProfile(profile: StyleProfile): void {
  const state = loadState();
  const existingIndex = state.profiles.findIndex((item: StyleProfile) => item.id === profile.id);
  const history = state.profileHistory[profile.id] ?? [];

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
  } else {
    state.profiles.push(profile);
    state.profileHistory[profile.id] = appendSnapshot(history, profile);
  }

  saveState(state);
}

export function removeProfile(id: string): void {
  const state = loadState();
  state.profiles = state.profiles.filter((item: StyleProfile) => item.id !== id);
  const nextHistory = { ...state.profileHistory };
  delete nextHistory[id];
  state.profileHistory = nextHistory;
  if (state.activeProfileId === id) state.activeProfileId = null;
  saveState(state);
}

export function setActiveProfile(id: string | null): void {
  const state = loadState();
  state.activeProfileId = id;
  saveState(state);
}
