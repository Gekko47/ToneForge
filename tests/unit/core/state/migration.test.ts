import { describe, it, expect } from "vitest";
import { migrate, CURRENT_STATE_VERSION } from "../../../../src/core/state/migration";

describe("migration", () => {
  it("has a current version", () => {
    expect(CURRENT_STATE_VERSION).toBe(1);
  });

  it("returns default state for null input", () => {
    const result = migrate(null);
    expect(result.version).toBe(1);
    expect(result.profiles).toEqual([]);
    expect(result.activeProfileId).toBeNull();
    expect(result.settings.telemetryDisabled).toBe(true);
  });

  it("returns default state for undefined input", () => {
    const result = migrate(undefined);
    expect(result.version).toBe(1);
    expect(result.profiles).toEqual([]);
  });

  it("returns default state for non-object input", () => {
    const result = migrate("not an object");
    expect(result.version).toBe(1);
    expect(result.profiles).toEqual([]);
  });

  it("returns default state for array input", () => {
    const result = migrate([]);
    expect(result.version).toBe(1);
    expect(result.profiles).toEqual([]);
  });

  it("passes through v1 state unchanged", () => {
    const v1 = {
      version: 1,
      profiles: [],
      activeProfileId: null,
      settings: { telemetryDisabled: false },
    };
    const result = migrate(v1);
    expect(result.version).toBe(1);
    expect(result.settings.telemetryDisabled).toBe(false);
  });

  it("migrates v0 (no version field) to v1", () => {
    const v0 = {
      profiles: [],
      activeProfileId: null,
      settings: {},
    };
    const result = migrate(v0);
    expect(result.version).toBe(1);
    expect(result.settings.telemetryDisabled).toBe(true);
  });

  it("migrates v0 with existing settings", () => {
    const v0 = {
      profiles: [],
      activeProfileId: null,
      settings: { openAiModel: "gpt-4o" },
    };
    const result = migrate(v0);
    expect(result.version).toBe(1);
    expect(result.settings.openAiModel).toBe("gpt-4o");
    expect(result.settings.telemetryDisabled).toBe(true);
  });
});
