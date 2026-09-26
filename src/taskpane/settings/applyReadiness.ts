/**
 * Pure apply-readiness decisions for the task pane.
 *
 * These stay free of Office, LLM, and React imports so they can be unit tested
 * directly, matching the pattern in [`settingsModel`](./settingsModel.ts). The
 * React layer renders their results; it never decides readiness itself.
 *
 * The rule this module exists to enforce: **a disabled Apply must always carry
 * the reason it is disabled.** `PendingChanges` already renders that reason
 * through `aria-describedby`; what was missing was a component that computed
 * the reason from the same facts `applyReviewedPlan` checks at run time. Two
 * places computing readiness from different inputs is how an enabled button ends
 * up refusing on click.
 */

import type { WordCapabilities } from "../../word/capabilityProbe";
import { getUnsupportedChangeIds } from "../../reformat/trackedEditing";
import type { Change } from "../../core/domain/Change";

export type ApplyReadinessVerdict =
  "ready" | "probePending" | "trackedEditingOff" | "noRevisionSupport" | "unsupportedOperations";

export interface ApplyReadiness {
  /** Single blocker, most specific first. `null` means Apply may be offered. */
  reason: string | null;
  /** Machine-readable form, used by tests and by the host-readiness banner. */
  verdict: ApplyReadinessVerdict;
  /**
   * True when the only thing missing is the probe, which Apply performs anyway.
   *
   * Apply is not blocked in that case: `prepareTrackedEditing` re-probes and arms
   * the gate immediately before the mutation, so offering the action is truthful
   * as long as the button is not described as verified.
   */
  probePendingOnly: boolean;
}

/** Human-facing name for the Word operation a change type needs. */
const OPERATION_LABEL: Readonly<Record<Change["type"], string>> = {
  insertText: "insert text",
  replaceText: "replace text",
  deleteRange: "delete a range",
  insertBreak: "insert a break",
  applyStyle: "apply a named style",
  setParagraphFormat: "set paragraph formatting",
  setCharacterFormat: "set character formatting",
  resetCharacterFormatting: "reset character formatting",
  setListLevel: "set a list level",
};

export interface ApplyReadinessInput {
  /** The persisted user preference. Defaults to on; readiness is separate. */
  trackedEditingEnabled: boolean;
  /**
   * The live probe result, or `null` when the host has not answered yet.
   *
   * `null` is not the same as "supported": nothing has claimed support, so no
   * capability statement may be made about this host.
   */
  capabilities: WordCapabilities | null;
  /** The changes a reviewed plan would apply, used to detect unsupported types. */
  changes: readonly Change[];
}

/**
 * Decide whether Apply may be offered, and why not when it may not.
 *
 * Order is what the user has to do first. Tracked editing is a decision they can
 * make now; a missing revision capability is a property of the host they cannot;
 * an unsupported operation names the exact change type the plan contains.
 */
export function applyReadiness(input: ApplyReadinessInput): ApplyReadiness {
  if (!input.trackedEditingEnabled) {
    return {
      reason:
        "Tracked editing is disabled, so no change can be applied. Enable it in Settings; preview and review stay available.",
      verdict: "trackedEditingOff",
      probePendingOnly: false,
    };
  }

  const capabilities = input.capabilities;
  if (capabilities === null) {
    // Nothing has been probed. Apply still works — it re-probes at the gate —
    // but the host must not be described as verified.
    return {
      reason: null,
      verdict: "probePending",
      probePendingOnly: true,
    };
  }

  if (!capabilities.supportsRevisions) {
    return {
      reason:
        "This Word host does not expose the revision capability, so changes cannot be applied as tracked revisions. Preview and review stay available.",
      verdict: "noRevisionSupport",
      probePendingOnly: false,
    };
  }

  const unsupportedIds = getUnsupportedChangeIds(input.changes, capabilities);
  if (unsupportedIds.length > 0) {
    const byId = new Map(input.changes.map((change) => [change.id, change]));
    const operations = [
      ...new Set(
        unsupportedIds
          .map((id) => byId.get(id))
          .filter((change): change is Change => change !== undefined)
          .map((change) => OPERATION_LABEL[change.type]),
      ),
    ];
    return {
      reason: `This Word host cannot ${operations.join(", ")}. Re-run the preview so the plan contains only supported changes.`,
      verdict: "unsupportedOperations",
      probePendingOnly: false,
    };
  }

  return { reason: null, verdict: "ready", probePendingOnly: false };
}

/**
 * The one-line verdict for the host-readiness banner on the governance page.
 *
 * Shares its vocabulary with {@link applyReadiness} deliberately: the banner and
 * the disabled Apply must not be able to disagree about the same host.
 */
export function hostReadinessMessage(input: {
  trackedEditingEnabled: boolean;
  capabilities: WordCapabilities | null;
}): { verdict: "ready" | "blocked" | "pending"; message: string } {
  if (!input.trackedEditingEnabled) {
    return {
      verdict: "blocked",
      message:
        "Tracked editing is off, so ToneForge can scan and preview but cannot change this document.",
    };
  }
  if (input.capabilities === null) {
    return {
      verdict: "pending",
      message: "Checking whether this Word host can apply tracked changes…",
    };
  }
  if (!input.capabilities.supportsRevisions) {
    return {
      verdict: "blocked",
      message:
        "This Word host does not support tracked revisions. ToneForge can scan and preview, but it will not change the document.",
    };
  }
  return {
    verdict: "ready",
    message: "This Word host can apply tracked changes.",
  };
}
