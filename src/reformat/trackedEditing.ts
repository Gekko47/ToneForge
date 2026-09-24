import { probeWordCapabilities, type WordCapabilities } from "../word/capabilityProbe";
import { setStage01Passed } from "../word/revisionAdapter";
import type { Change } from "../core/domain/Change";

const TRACKED_EDITING_KEY = "ToneForge.TrackedEditingEnabled";

export interface TrackedEditingPreparation {
  enabled: boolean;
  capabilities: WordCapabilities | null;
  unsupportedChangeIds: string[];
  error: string | null;
}

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(TRACKED_EDITING_KEY) !== "false";
  } catch {
    return true;
  }
}

export function isTrackedEditingEnabled(): boolean {
  return readEnabled();
}

export function setTrackedEditingEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(TRACKED_EDITING_KEY, String(enabled));
  } catch {
    // The in-memory gate is still updated when storage is unavailable.
  }
  if (!enabled) setStage01Passed(false);
}

function requiredCapability(
  change: Change,
): keyof Pick<
  WordCapabilities,
  | "supportsInsertText"
  | "supportsReplaceText"
  | "supportsInsertBreak"
  | "supportsStyles"
  | "supportsParagraphFormat"
  | "supportsCharacterFormat"
  | "supportsResetCharacterFormatting"
  | "supportsListLevel"
> {
  switch (change.type) {
    case "insertText":
      return "supportsInsertText";
    case "replaceText":
    case "deleteRange":
      return "supportsReplaceText";
    case "insertBreak":
      return "supportsInsertBreak";
    case "applyStyle":
      return "supportsStyles";
    case "setParagraphFormat":
      return "supportsParagraphFormat";
    case "setCharacterFormat":
      return "supportsCharacterFormat";
    case "resetCharacterFormatting":
      return "supportsResetCharacterFormatting";
    case "setListLevel":
      return "supportsListLevel";
  }
}

export function getUnsupportedChangeIds(
  changes: readonly Change[],
  capabilities: WordCapabilities,
): string[] {
  return changes
    .filter((change) => capabilities[requiredCapability(change)] === false)
    .map((change) => change.id);
}

/** Probe and arm the sole mutation adapter immediately before strict Apply. */
export async function prepareTrackedEditing(
  changes: readonly Change[],
): Promise<TrackedEditingPreparation> {
  if (!isTrackedEditingEnabled()) {
    setStage01Passed(false);
    return {
      enabled: false,
      capabilities: null,
      unsupportedChangeIds: [],
      error: "Tracked editing is disabled. Enable it in Troubleshooting before applying.",
    };
  }

  const capabilities = await probeWordCapabilities();
  if (!capabilities.supportsRevisions) {
    setStage01Passed(false, capabilities);
    return {
      enabled: true,
      capabilities,
      unsupportedChangeIds: changes.map((change) => change.id),
      error: "This Word host does not expose the revision capability required for tracked editing.",
    };
  }

  const unsupportedChangeIds = getUnsupportedChangeIds(changes, capabilities);
  setStage01Passed(unsupportedChangeIds.length === 0, capabilities);
  return {
    enabled: true,
    capabilities,
    unsupportedChangeIds,
    error:
      unsupportedChangeIds.length === 0
        ? null
        : "The Word host does not support every operation required by this plan.",
  };
}
