/**
 * Application state persistence.
 *
 * Primary store: Office roamingSettings (survives across sessions).
 * Fallback: localStorage (used when Office runtime is unavailable,
 * e.g. in unit tests or when running outside Word).
 */

import { z } from "zod";
import { StyleProfileSchema, type StyleProfile } from "../domain/StyleProfile";

const StateSchema = z.object({
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

function setRoamingSettings(value: Record<string, unknown>): void {
  const office = (
    globalThis as unknown as {
      Office: { roamingSettings?: { set: (k: string, v: unknown) => void } };
    }
  ).Office;
  const settings = office?.roamingSettings;
  if (settings) {
    settings.set(STORAGE_KEY, JSON.stringify(value));
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
    getLocalStorage() ?? { profiles: [], activeProfileId: null, settings: {} };
  return StateSchema.parse(raw);
}

export function saveState(state: PersistedState): void {
  const parsed = StateSchema.parse(state);
  const payload = { ...parsed };
  try {
    setRoamingSettings(payload);
  } catch {
    // Fall back silently if roamingSettings throws.
  }
  setLocalStorage(payload);
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
