// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyProfile } from "../../../../src/core/domain/index";
import { loadState, saveState, upsertProfile } from "../../../../src/core/state/index";

describe("persistence without browser storage", () => {
  let originalOffice: unknown;

  beforeEach(() => {
    originalOffice = (globalThis as { Office?: unknown }).Office;
    (globalThis as { Office?: unknown }).Office = undefined;
  });

  afterEach(() => {
    (globalThis as { Office?: unknown }).Office = originalOffice;
  });

  it("uses a process-local memory fallback without probing global localStorage", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("global localStorage must not be accessed");
      },
    });

    try {
      const profile = createEmptyProfile("Node fallback");
      upsertProfile(profile);

      const state = loadState();
      expect(state.profiles).toHaveLength(1);
      expect(state.profiles[0]?.name).toBe("Node fallback");

      saveState({
        ...state,
        settings: {
          ...state.settings,
          telemetryDisabled: false,
        },
      });
      expect(loadState().settings.telemetryDisabled).toBe(false);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "localStorage", originalDescriptor);
      } else {
        delete (globalThis as { localStorage?: Storage }).localStorage;
      }
    }
  });
});
