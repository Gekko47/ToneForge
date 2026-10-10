import React from "react";
import { loadState, saveState, type PersistedState } from "../../core/state/index";
import { SettingsDashboard } from "../components/SettingsDashboard";
import { Breadcrumb } from "../shell";

export interface LlmSettingsProps {
  onBack: () => void;
}

export default function LlmSettings({ onBack }: LlmSettingsProps): React.ReactNode {
  const [state, setState] = React.useState<PersistedState>(() => loadState());

  function handleStateChange(next: PersistedState): void {
    setState(next);
    saveState(next);
  }

  return (
    <div data-page="llm-settings">
      <Breadcrumb label="Back to Deterministic Review" onBack={onBack} />
      <h2 className="tf-title">LLM Settings</h2>
      <SettingsDashboard state={state} onStateChange={handleStateChange} />
    </div>
  );
}
