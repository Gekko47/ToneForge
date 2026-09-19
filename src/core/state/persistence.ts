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

const StateSchema = z.object({
  version: z.number().int().nonnegative().default(1),
  profiles: z.array(StyleProfileSchema).default([]),
  activeProfileId: z.string().uuid().nullable().default(null),
  settings: z
    .object({
      openAiApiKey: z.string().optional(),
      openAiBaseUrl: z.string().url().optional(),
      openAiModel: z.string().optional(),
      telemetryDisabled: z.boolean().default(true),
    })
    .default({}),
});

export type PersistedState = z.infer<typeof StateSchema>;

const STORAGE_KEY = "ToneForge.State.v1";

function isOfficeRuntime(): boolean {
  return typeof (globalThis as unknown as { Office?: unknown }).Office !== "undefined";
}

function getRoamingSettings(): Record<string, unknown> | null {
  if (!isOfficeRuntime()) return null;
  try {
    const office = (
      globalThis as unknown as {
        Office: { roamingSettings?: { get: (k: string) => unknown } };
      }
    ).Office;
    const settings = office.roamingSettings;
    if (!settings) return null;
    const raw = settings.get(STORAGE_KEY);
    if (typeof raw !== "string") return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function setRoamingSettingsAsync(value: Record<string, unknown>): Promise<void> {
  const office = (
    globalThis as unknown as {
      Office: {
        roamingSettings?: {
          set: (key: string, v: unknown) => void;
          saveAsync: (callback?: (result: unknown) => void) => void;
        };
      };
    }
  ).Office;
  const settings = office?.roamingSettings;
  if (!settings) return;
  settings.set(STORAGE_KEY, JSON.stringify(value));
  // Persist to the Office document. Without this call, roamingSettings
  // changes are discarded when the add-in closes.
  if (typeof settings.saveAsync === "function") {
    await new Promise<void>((resolve) => {
      try {
        settings.saveAsync(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}

function getLocalStorage(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function setLocalStorage(value: Record<string, unknown>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function loadState(): PersistedState {
  const raw = getRoamingSettings() ??
    getLocalStorage() ?? { version: 1, profiles: [], activeProfileId: null, settings: {} };
  try {
    return StateSchema.parse(raw);
  } catch (err) {
    // Corrupted or incompatible persisted state: fall back to defaults
    // rather than crashing the add-in. The previous value is unrecoverable.
    console.warn(
      "Failed to parse persisted state; falling back to defaults:",
      err instanceof Error ? err.message : String(err),
    );
    return {
      version: 1,
      profiles: [],
      activeProfileId: null,
      settings: { telemetryDisabled: true },
    };
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

export function upsertProfile(profile: StyleProfile): void {
  const state = loadState();
  const existing = state.profiles.findIndex((p: StyleProfile) => p.id === profile.id);
  if (existing >= 0) {
    state.profiles[existing] = {
      ...state.profiles[existing],
      ...profile,
      updatedAt: new Date().toISOString(),
    };
  } else {
    state.profiles.push(profile);
  }
  saveState(state);
}

export function removeProfile(id: string): void {
  const state = loadState();
  state.profiles = state.profiles.filter((p: StyleProfile) => p.id !== id);
  if (state.activeProfileId === id) state.activeProfileId = null;
  saveState(state);
}

export function setActiveProfile(id: string | null): void {
  const state = loadState();
  state.activeProfileId = id;
  saveState(state);
}
