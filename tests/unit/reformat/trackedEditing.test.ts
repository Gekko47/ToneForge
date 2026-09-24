import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getUnsupportedChangeIds,
  isTrackedEditingEnabled,
  prepareTrackedEditing,
  setTrackedEditingEnabled,
} from "../../../src/reformat/trackedEditing";
import * as capabilityProbe from "../../../src/word/capabilityProbe";
import { STAGE_01_PASSED, setStage01Passed } from "../../../src/word/revisionAdapter";
import type { WordCapabilities } from "../../../src/word/capabilityProbe";
import type { Change } from "../../../src/core/domain/Change";

const FULL_CAPABILITIES: WordCapabilities = {
  supportsInsertText: true,
  supportsReplaceText: true,
  supportsInsertParagraph: true,
  supportsInsertBreak: true,
  supportsStyles: true,
  supportsParagraphFormat: true,
  supportsCharacterFormat: true,
  supportsResetCharacterFormatting: true,
  supportsListLevel: true,
  supportsRevisions: true,
  supportsSelection: true,
  supportsParagraphResolution: true,
  supportsHighlight: true,
  supportsContextMenu: true,
  hostName: "Word",
  hostVersion: "16.0",
};

function makeChange(overrides: Partial<Change> = {}): Change {
  return {
    id: "change-1",
    type: "resetCharacterFormatting",
    range: { start: 0, end: 0 },
    payload: {},
    reversible: true,
    dependsOn: [],
    ...overrides,
  } as Change;
}

describe("tracked editing preparation", () => {
  beforeEach(() => {
    window.localStorage.removeItem("ToneForge.TrackedEditingEnabled");
    setStage01Passed(false);
  });

  afterEach(() => {
    window.localStorage.removeItem("ToneForge.TrackedEditingEnabled");
    setStage01Passed(false);
    vi.restoreAllMocks();
  });

  it("defaults to enabled and disarms the adapter when switched off", () => {
    expect(isTrackedEditingEnabled()).toBe(true);
    setStage01Passed(true, FULL_CAPABILITIES);
    setTrackedEditingEnabled(false);
    expect(isTrackedEditingEnabled()).toBe(false);
    expect(STAGE_01_PASSED).toBe(false);
  });

  it("probes and arms verified capabilities for a supported plan", async () => {
    const probe = vi
      .spyOn(capabilityProbe, "probeWordCapabilities")
      .mockResolvedValue(FULL_CAPABILITIES);

    const result = await prepareTrackedEditing([makeChange()]);

    expect(probe).toHaveBeenCalledOnce();
    expect(result.error).toBeNull();
    expect(result.unsupportedChangeIds).toEqual([]);
    expect(STAGE_01_PASSED).toBe(true);
  });

  it("refuses the whole plan when a required operation is unsupported", () => {
    const capabilities = { ...FULL_CAPABILITIES, supportsResetCharacterFormatting: false };
    expect(getUnsupportedChangeIds([makeChange()], capabilities)).toEqual(["change-1"]);
  });

  it("does not probe when tracked editing is disabled", async () => {
    setTrackedEditingEnabled(false);
    const probe = vi.spyOn(capabilityProbe, "probeWordCapabilities");

    const result = await prepareTrackedEditing([makeChange()]);

    expect(probe).not.toHaveBeenCalled();
    expect(result.error).toContain("Tracked editing is disabled");
  });
});
