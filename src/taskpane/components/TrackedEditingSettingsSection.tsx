import React, { useState } from "react";
import { MessageBar, MessageBarType, Toggle } from "@fluentui/react";
import {
  isTrackedEditingEnabled,
  prepareReformatHost,
  prepareTrackedEditing,
  setTrackedEditingEnabled,
} from "../../reformat";
import type { WordCapabilities } from "../../word/capabilityProbe";

/**
 * Tracked editing control.
 *
 * This is an ordinary user setting, not a diagnostic, so it lives in Settings
 * rather than in the troubleshooting surface. Apply always re-probes the host
 * and re-checks every operation in the plan, so this toggle is the user's
 * standing intent, never a substitute for that gate.
 *
 * The enable path persists `true` **before** calling `prepareTrackedEditing()`.
 * That ordering is the whole fix: the preparation function re-reads the
 * persisted flag and refuses when it is `false`, so enabling without persisting
 * first made the toggle snap straight back to off and left the user with no way
 * to arm tracked editing at all.
 */
export default function TrackedEditingSettingsSection(): React.ReactNode {
  const [enabled, setEnabled] = useState(isTrackedEditingEnabled);
  const [capabilities, setCapabilities] = useState<WordCapabilities | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function change(_event: unknown, checked: boolean): Promise<void> {
    setMessage(null);

    if (!checked) {
      setTrackedEditingEnabled(false);
      setEnabled(false);
      setMessage(
        "Tracked editing is disabled. Preview and review stay available; Apply is blocked.",
      );
      return;
    }

    setBusy(true);
    // Persist first. The preparation reads this value back, so writing it after
    // the call would ask the gate a question it already knows the answer to.
    setTrackedEditingEnabled(true);
    try {
      const preparation = await prepareTrackedEditing([]);
      setCapabilities(preparation.capabilities);
      if (preparation.error !== null) {
        setTrackedEditingEnabled(false);
        setEnabled(false);
        setMessage(preparation.error);
        return;
      }
      setEnabled(true);
      setMessage(
        "Tracked editing is enabled. Apply still re-checks every change against this host.",
      );
    } catch (error: unknown) {
      setTrackedEditingEnabled(false);
      setEnabled(false);
      setMessage(
        error instanceof Error
          ? `Tracked editing could not be prepared: ${error.message}`
          : "Tracked editing could not be prepared. Check the host diagnostics and retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function probe(): Promise<void> {
    setBusy(true);
    try {
      setCapabilities(await prepareReformatHost());
    } catch {
      setCapabilities(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="tf-settings-section" aria-labelledby="tracked-editing-heading">
      <h2 id="tracked-editing-heading">Tracked editing</h2>
      <p className="tf-sub">
        Controls whether ToneForge may change the document. When it is on, every applied change is
        recorded as a Word revision so it can be reviewed and undone in Word. Track Changes can
        never be bypassed.
      </p>
      <div className="tf-settings-fields">
        <Toggle
          label="Allow ToneForge to apply tracked changes"
          checked={enabled}
          disabled={busy}
          onChange={(event, checked) => void change(event, checked ?? false)}
          onText="Enabled"
          offText="Disabled"
        />
        {message && (
          <MessageBar
            messageBarType={enabled ? MessageBarType.info : MessageBarType.warning}
            role="status"
            aria-live="polite"
          >
            {message}
          </MessageBar>
        )}
        {capabilities !== null && capabilities.supportsRevisions === false && (
          <MessageBar messageBarType={MessageBarType.error} role="alert">
            This Word host does not expose the revision capability, so tracked editing cannot be
            armed here. Preview and review remain available.
          </MessageBar>
        )}
      </div>
      <div className="tf-settings-actions">
        <button
          className="tf-native-button"
          type="button"
          onClick={() => void probe()}
          disabled={busy}
        >
          {busy ? "Checking this Word host…" : "Check this Word host"}
        </button>
      </div>
    </section>
  );
}
