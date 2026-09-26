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

/**
 * Set once `prepareTrackedEditing` has probed this host at least once.
 *
 * Module-scoped rather than persisted: readiness is a property of the running
 * host, not of the user, and a persisted "ready" would be a lie about a host that
 * has not been seen since the last session.
 */
let trackedEditingPrepared = false;

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

/**
 * Whether a persisted capability probe has been taken on this host.
 *
 * The preference defaults to enabled, so the *intent* is on before anything has
 * been probed. The *readiness* is not: `STAGE_01_PASSED` in the revision adapter
 * stays false until `prepareTrackedEditing` has probed the real host. Reporting
 * the preference as if it were readiness would tell the user their host is ready
 * before anything has checked, so the two are kept separate (ADR-0058).
 */
export function isTrackedEditingReadinessKnown(): boolean {
  return trackedEditingPrepared;
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
      error: "Tracked editing is disabled. Enable it in Settings before applying.",
    };
  }

  // From here the host has been, or is about to be, probed for real.
  trackedEditingPrepared = true;

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
