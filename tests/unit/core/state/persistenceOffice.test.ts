import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEmptyProfile } from "../../../../src/core/domain/index";
import {
  clearPersistedCredentials,
  loadState,
  saveState,
  upsertProfile,
} from "../../../../src/core/state/index";

describe("persistence with Office roamingSettings", () => {
  let officeRuntime:
    | {
        roamingSettings?: {
          get: (k: string) => unknown;
          set: (k: string, v: unknown) => void;
          remove: (k: string) => void;
          saveAsync: (cb?: (result: unknown) => void) => void;
        };
      }
    | undefined;

  beforeEach(() => {
    window.localStorage.clear();
    officeRuntime = {
      roamingSettings: {
        get: () => null,
        set: () => {},
        remove: () => {},
        saveAsync: (cb?: (result: unknown) => void) => {
          if (cb) cb(true);
        },
      },
    };
    (globalThis as unknown as { Office?: typeof officeRuntime }).Office = officeRuntime;
  });

  afterEach(() => {
    (globalThis as unknown as { Office?: typeof officeRuntime }).Office = undefined;
    window.localStorage.clear();
  });

  it("reads from roamingSettings when available", () => {
    const profile = createEmptyProfile("From Office");
    upsertProfile(profile);
    const state = loadState();
    expect(state.profiles).toHaveLength(1);
    expect(state.profiles[0]?.name).toBe("From Office");
    expect(state.profileHistory[profile.id]).toHaveLength(1);
  });

  it("falls back to defaults on corrupted JSON", () => {
    if (!officeRuntime?.roamingSettings) throw new Error("setup");
    officeRuntime.roamingSettings.get = () => "{ not valid json";
    const state = loadState();
    expect(state.profiles).toEqual([]);
    expect(state.profileHistory).toEqual({});
    expect(state.activeProfileId).toBeNull();
    expect(state.settings.telemetryDisabled).toBe(true);
  });

  it("falls back to defaults on schema-incompatible payload", () => {
    if (!officeRuntime?.roamingSettings) throw new Error("setup");
    officeRuntime.roamingSettings.get = () =>
      JSON.stringify({ version: 1, profiles: "not-an-array" });
    const state = loadState();
    expect(state.profiles).toEqual([]);
    expect(state.profileHistory).toEqual({});
  });

  it("saveState persists through saveAsync", async () => {
    let persisted: unknown = null;
    if (!officeRuntime?.roamingSettings) throw new Error("setup");
    officeRuntime.roamingSettings.get = () => persisted as string;
    officeRuntime.roamingSettings.set = (_k: string, v: unknown) => {
      persisted = v;
    };
    officeRuntime.roamingSettings.saveAsync = (cb?: (result: unknown) => void) => {
      if (cb) cb(true);
    };

    saveState({
      version: 5,
      profiles: [],
      profileHistory: {},
      activeProfileId: null,
      governanceProfiles: {},
      governanceHistory: {},
      activeGovernanceProfileId: null,
      settings: {
        llmProvider: "mock",
        openAiCredentialMode: "broker" as const,
        spotReviewConsent: false,
        fullDocumentReviewConsent: false,
        semanticOptIn: false,
        telemetryDisabled: true,
      },
    });

    // Give the async save a tick to resolve.
    await new Promise((r) => setTimeout(r, 10));
    expect(typeof persisted).toBe("string");
    const parsed = JSON.parse(persisted as string) as { version: number };
    expect(parsed.version).toBe(5);
  });

  it("migrates v0 state (no version field) to v5 via loadState", () => {
    if (!officeRuntime?.roamingSettings) throw new Error("setup");
    // v0 persisted state had no `version` field. Migration upgrades the
    // version and preserves existing settings values over defaults.
    officeRuntime.roamingSettings.get = () =>
      JSON.stringify({
        profiles: [],
        activeProfileId: null,
        settings: { telemetryDisabled: false },
      });
    const state = loadState();
    expect(state.version).toBe(5);
    expect(state.profileHistory).toEqual({});
    expect(state.settings.telemetryDisabled).toBe(false);
  });

  it("fills missing settings with defaults during v0 migration", () => {
    if (!officeRuntime?.roamingSettings) throw new Error("setup");
    officeRuntime.roamingSettings.get = () =>
      JSON.stringify({
        profiles: [],
        activeProfileId: null,
        settings: {},
      });
    const state = loadState();
    expect(state.version).toBe(5);
    expect(state.settings.telemetryDisabled).toBe(true);
  });

  it("preserves v1 state by upgrading it to v5", () => {
    if (!officeRuntime?.roamingSettings) throw new Error("setup");
    officeRuntime.roamingSettings.get = () =>
      JSON.stringify({
        version: 1,
        profiles: [],
        activeProfileId: null,
        settings: { telemetryDisabled: true },
      });
    const state = loadState();
    expect(state.version).toBe(5);
    expect(state.profileHistory).toEqual({});
    expect(state.settings.telemetryDisabled).toBe(true);
  });

  it("falls back to legacy v1 storage key when v5 is absent", () => {
    if (!officeRuntime?.roamingSettings) throw new Error("setup");
    officeRuntime.roamingSettings.get = (key: string) =>
      key === "ToneForge.State.v5"
        ? null
        : JSON.stringify({
            version: 1,
            profiles: [],
            activeProfileId: null,
            settings: { telemetryDisabled: true },
          });
    const state = loadState();
    expect(state.version).toBe(5);
    expect(state.profiles).toEqual([]);
  });

  it("purges a legacy plaintext key from both storage paths", async () => {
    if (!officeRuntime?.roamingSettings) throw new Error("setup");
    const values = new Map<string, unknown>();
    officeRuntime.roamingSettings.get = (key) => values.get(key) ?? null;
    officeRuntime.roamingSettings.set = (key, value) => values.set(key, value);
    officeRuntime.roamingSettings.remove = (key) => values.delete(key);
    values.set(
      "ToneForge.State.v3",
      JSON.stringify({
        version: 3,
        profiles: [],
        settings: {
          openAiApiKey: "sk-legacy-secret-value",
          llmProvider: "openai",
          spotReviewConsent: true,
        },
      }),
    );
    window.localStorage.setItem(
      "ToneForge.State.v3",
      JSON.stringify({
        version: 3,
        profiles: [],
        settings: { openAiApiKey: "sk-legacy-secret-value" },
      }),
    );

    const state = loadState();
    expect(state.settings).not.toHaveProperty("openAiApiKey");
    expect(state.settings.spotReviewConsent).toBe(true);
    expect(values.has("ToneForge.State.v3")).toBe(false);
    expect(window.localStorage.getItem("ToneForge.State.v3")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(String(values.get("ToneForge.State.v5"))).not.toContain("openAiApiKey");
  });

  it("clear-secret selects mock without changing consent", () => {
    window.localStorage.setItem(
      "ToneForge.State.v3",
      JSON.stringify({
        version: 3,
        profiles: [],
        settings: {
          openAiApiKey: "sk-legacy-secret-value",
          llmProvider: "openai",
          spotReviewConsent: true,
          fullDocumentReviewConsent: true,
        },
      }),
    );

    const state = clearPersistedCredentials();
    expect(state.settings.llmProvider).toBe("mock");
    expect(state.settings.openAiCredentialMode).toBe("broker");
    expect(state.settings.spotReviewConsent).toBe(true);
    expect(state.settings.fullDocumentReviewConsent).toBe(true);
    expect(JSON.stringify(state)).not.toContain("openAiApiKey");
  });
});
