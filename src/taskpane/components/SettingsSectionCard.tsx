import React from "react";
import { DefaultButton, MessageBar, MessageBarType, PrimaryButton } from "@fluentui/react";
import { INITIAL_SECTION_STATUS, type SectionStatus } from "../settings/settingsModel";

export interface SettingsSectionCardProps {
  title: string;
  description: string;
  status: SectionStatus;
  saveLabel: string;
  onSave: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}

/**
 * Shared chrome for one independently-saved settings section.
 *
 * Exactly one live region is rendered per card and it only appears after a
 * successful save, so unsaved edits are not announced as if they were applied.
 */
export default function SettingsSectionCard({
  title,
  description,
  status,
  saveLabel,
  onSave,
  onCancel,
  children,
}: SettingsSectionCardProps): React.ReactNode {
  const headingId = `${title.replace(/\s+/g, "-").toLowerCase()}-heading`;
  return (
    <section className="tf-settings-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <p className="tf-sub">{description}</p>
      {status.error && (
        <MessageBar messageBarType={MessageBarType.error} role="alert">
          {status.error}
        </MessageBar>
      )}
      {status.savedAt && (
        <MessageBar messageBarType={MessageBarType.success} role="status" aria-live="polite">
          {title} settings saved.
        </MessageBar>
      )}
      <div className="tf-settings-fields">{children}</div>
      <div className="tf-settings-actions">
        <PrimaryButton text={saveLabel} onClick={onSave} disabled={!status.dirty} />
        <DefaultButton text="Cancel" onClick={onCancel} disabled={!status.dirty} />
      </div>
    </section>
  );
}

export { INITIAL_SECTION_STATUS };
