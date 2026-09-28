/**
 * When the pane scans the document.
 *
 * The setting already existed, was migrated, and was honoured by the
 * Dashboard — the observer only subscribes when it is on. What was missing was
 * any way to change it, so it was a stored intention with no control behind it.
 *
 * It is its own section rather than another toggle inside Styling, because that
 * section states outright that no document behaviour is affected by it. Folding
 * a scan toggle in there would have made that sentence false, and a false claim
 * in a component header is worse than a missing control.
 */

import React from "react";
import { Toggle } from "@fluentui/react";
import { loadState, saveState } from "../../core/state/persistence";
import {
  INITIAL_SECTION_STATUS,
  markDirty,
  markSaved,
  type SectionStatus,
} from "../settings/settingsModel";
import SettingsSectionCard from "./SettingsSectionCard";

/**
 * Why turning this off still leaves the pane useful.
 *
 * Stated in the section rather than only in documentation, because the obvious
 * fear is that switching it off disables ToneForge. It does not: the manual
 * scan still works, and that is the way back.
 */
export const AUTO_SCAN_OFF_NOTE =
  "ToneForge will stop scanning as you type. Re-scan now on Document Governance still works, " +
  "and the findings and pending changes you already have are not affected.";

export default function ScanningSettingsSection(): React.ReactNode {
  const [committed, setCommitted] = React.useState(() => loadState().settings.autoScan);
  const [draft, setDraft] = React.useState(committed);
  const [status, setStatus] = React.useState<SectionStatus>(INITIAL_SECTION_STATUS);
  const dirty = status.dirty || draft !== committed;

  function save(): void {
    const current = loadState();
    saveState({ ...current, settings: { ...current.settings, autoScan: draft } });
    setCommitted(draft);
    setStatus(markSaved());
  }

  return (
    <SettingsSectionCard
      title="Scanning"
      description="Choose when ToneForge checks this document."
      status={{ ...status, dirty }}
      saveLabel="Save scanning"
      onSave={save}
      onCancel={() => {
        setDraft(committed);
        setStatus(INITIAL_SECTION_STATUS);
      }}
    >
      <Toggle
        label="Scan automatically as the document changes"
        checked={draft}
        onText="On"
        offText="Off"
        onChange={(_event, checked) => {
          setDraft(checked ?? false);
          setStatus(markDirty());
        }}
      />
      <p className="tf-sub">
        {draft
          ? "Findings update a moment after you stop typing. Nothing is ever changed in the document without your approval."
          : AUTO_SCAN_OFF_NOTE}
      </p>
    </SettingsSectionCard>
  );
}
