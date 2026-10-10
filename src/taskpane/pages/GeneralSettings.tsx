import React from "react";
import ScanningSettingsSection from "../components/ScanningSettingsSection";
import { Breadcrumb } from "../shell";
import type { TaskPaneDestination } from "../routes";
import StylingSettingsSection from "../components/StylingSettingsSection";
import TrackedEditingSettingsSection from "../components/TrackedEditingSettingsSection";

export interface GeneralSettingsProps {
  onBack: () => void;
  /** The page this breadcrumb returns to: the previous page, or Home. */
  parent: TaskPaneDestination | null;
}

/**
 * The project-wide settings that are not about a provider.
 *
 * A composition shell over three independently-saved sections, exactly as
 * ADR-0047 described Settings before the LLM connector change replaced the page
 * with the LLM dashboard. Each section owns its own draft/commit/persist
 * behaviour, so this page adds no data plumbing — it only mounts them.
 *
 * Scanning, tracked editing, and styling are deliberately not on the LLM page:
 * none of them governs whether text may leave the add-in, and the LLM page's
 * redaction section is the single consent surface.
 */
export default function GeneralSettings({ onBack, parent }: GeneralSettingsProps): React.ReactNode {
  return (
    <div data-page="general-settings">
      <Breadcrumb parent={parent} onBack={onBack} />
      <h2 className="tf-title">General Settings</h2>
      <ScanningSettingsSection />
      <TrackedEditingSettingsSection />
      <StylingSettingsSection />
    </div>
  );
}
