// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyProfile } from "../../../../src/core/domain/index";
import { createRecord, newProfileId } from "../../../../src/core/domain/ProfileRecord";
import { loadState, saveProfileRecord, saveState } from "../../../../src/core/state/index";

const NOW = "2026-01-01T00:00:00.000Z";

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
      const rec = createRecord(
        newProfileId(),
        "Node fallback",
        NOW,
        createEmptyProfile("Node fallback", 1),
      );
      saveProfileRecord(rec);

      const state = loadState();
      expect(Object.keys(state.profileRecords)).toHaveLength(1);
      expect(state.profileRecords[rec.id]?.name).toBe("Node fallback");

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
