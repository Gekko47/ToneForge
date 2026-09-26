/**
 * Application state persistence.
 *
 * Primary store: Office roamingSettings (survives across sessions).
 * Fallback: localStorage (used when Office runtime is unavailable).
 *
 * `profileRecords` is the single source of truth for style profiles: one record
 * per profile holds its draft, published versions, and revision audit trail.
 * There is no separate profile list or history map, so no two structures can
 * disagree. Credentials are not part of ordinary state; legacy credential
 * fields are removed during migration and their legacy storage records purged.
 */

import { z } from "zod";
import { logger } from "../../shared/utils/logger";
import { type StyleProfile } from "../domain/StyleProfile";
import { ProviderConnectionSchema, ProviderIdSchema } from "../domain/ProviderConnection";
import {
  createGovernanceProfile,
  GovernanceProfileSchema,
  type GovernanceProfile,
} from "../domain/GovernanceProfile";
import {
  createRecord,
  effectiveProfile,
  newProfileId,
  ProfileRecordSchema,
  type ProfileRecord,
} from "../domain/ProfileRecord";
import { CURRENT_STATE_VERSION, migrate } from "./migration";

const StateSchema = z.object({
  version: z.number().int().nonnegative().default(8),
  profileRecords: z.record(z.string().uuid(), ProfileRecordSchema).default({}),
  activeProfileId: z.string().uuid().nullable().default(null),
  governanceProfiles: z.record(z.string().uuid(), GovernanceProfileSchema).default({}),
  governanceHistory: z.record(z.string().uuid(), z.array(GovernanceProfileSchema)).default({}),
  activeGovernanceProfileId: z.string().uuid().nullable().default(null),
  settings: z
    .object({
      openAiBaseUrl: z.string().url().optional(),
      openAiModel: z.string().optional(),
      // v8 widens this from the OpenAI-only pair. `openAiBaseUrl` and
      // `openAiModel` are retained for the local development path and are
      // superseded by a stored `providerConnections` entry once one exists.
      llmProvider: z.enum(["openai", "anthropic", "openrouter", "mock"]).default("mock"),
      openAiCredentialMode: z.literal("broker").default("broker"),
      spotReviewConsent: z.boolean().default(false),
      fullDocumentReviewConsent: z.boolean().default(false),
      telemetryDisabled: z.boolean().default(true),
      semanticOptIn: z.boolean().default(false),
    })
    .default({}),
  /**
   * Provider-neutral, non-secret connection records keyed by provider id.
   * This is the only provider structure that may be persisted, and it has no
   * field capable of holding a credential.
   */
  // Optional rather than defaulted: a v7 record has no such field, and making it
  // required in the inferred type would break every existing state fixture.
  // `migrate()` always populates it, so callers never see `undefined` at runtime.
  providerConnections: z.record(ProviderIdSchema, ProviderConnectionSchema).optional(),
});

export type PersistedState = z.infer<typeof StateSchema>;

const STORAGE_KEY = "ToneForge.State.v8";
const LEGACY_STORAGE_KEYS = [
  "ToneForge.State.v7",
  "ToneForge.State.v6",
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
 * validation, so legacy v0-v6 state is upgraded instead of discarded.
 */
export function loadState(): PersistedState {
  const raw = getRoamingSettings() ??
    getLocalStorage() ?? {
      version: CURRENT_STATE_VERSION,
      profileRecords: {},
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
      !Object.prototype.hasOwnProperty.call(raw, "profileRecords")
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
    providerConnections: {},
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

function appendGovernanceSnapshot(
  history: readonly GovernanceProfile[],
  profile: GovernanceProfile,
): GovernanceProfile[] {
  const latest = history[history.length - 1];
  return latest && JSON.stringify(latest) === JSON.stringify(profile)
    ? [...history]
    : [...history, profile];
}

/**
 * Persist a profile record together with its governance policy.
 *
 * Records are the only writer of profile data. When a profile is new, an
 * initial governance profile is seeded so normative policy always exists for
 * the record's style; when it already exists, the wrapped style snapshot is
 * refreshed to match the record's effective profile (the active published
 * version, else the draft), so governance never cites an unpublished draft.
 */
export function saveProfileRecord(record: ProfileRecord): void {
  const state = loadState();
  const parsed = ProfileRecordSchema.parse(record);
  state.profileRecords[parsed.id] = parsed;

  const style = effectiveProfile(parsed);
  if (style) {
    const existing = state.governanceProfiles[parsed.id];
    const nextGovernance = existing
      ? GovernanceProfileSchema.parse({ ...existing, style })
      : GovernanceProfileSchema.parse({ ...createGovernanceProfile(style), id: parsed.id });
    state.governanceProfiles[parsed.id] = nextGovernance;
    const history = state.governanceHistory[parsed.id] ?? [nextGovernance];
    state.governanceHistory[parsed.id] = appendGovernanceSnapshot(history, nextGovernance);
  }

  saveState(state);
}

/**
 * Read a profile record, or null when the profile does not exist. Callers that
 * need a record for a new profile create one with `createRecord`.
 */
export function loadProfileRecord(id: string): ProfileRecord | null {
  return loadState().profileRecords[id] ?? null;
}

/** Create and persist a brand new record, seeding governance from the draft. */
export function createProfileRecord(name: string, now: string, seed?: StyleProfile): ProfileRecord {
  const record = createRecord(newProfileId(), name, now, seed);
  saveProfileRecord(record);
  return record;
}

export function removeProfile(id: string): void {
  const state = loadState();
  const nextRecords = { ...state.profileRecords };
  delete nextRecords[id];
  state.profileRecords = nextRecords;
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
