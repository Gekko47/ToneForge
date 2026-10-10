import React from "react";
import { loadState, saveState, type PersistedState } from "../../core/state/index";
import { SettingsDashboard } from "../components/SettingsDashboard";
import { Breadcrumb } from "../shell";
import type { TaskPaneDestination } from "../routes";

export interface LlmSettingsProps {
  onBack: () => void;
  /** The page this breadcrumb returns to: the previous page, or Home. */
  parent: TaskPaneDestination | null;
}

export default function LlmSettings({ onBack, parent }: LlmSettingsProps): React.ReactNode {
  const [state, setState] = React.useState<PersistedState>(() => loadState());

  function handleStateChange(next: PersistedState): void {
    setState(next);
    saveState(next);
  }

  return (
    <div data-page="llm-settings">
      <Breadcrumb parent={parent} onBack={onBack} />
      <h2 className="tf-title">LLM Settings</h2>
      <SettingsDashboard state={state} onStateChange={handleStateChange} />
    </div>
  );
}
