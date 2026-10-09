import React from "react";
import { loadState, saveState, type PersistedState } from "../../core/state/index";
import { SettingsDashboard } from "../components/SettingsDashboard";

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
    <div className="tf-card" data-page="llm-settings">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button className="tf-native-button" type="button" onClick={onBack}>
          Back to Deterministic Review
        </button>
      </nav>
      <h2 className="tf-title">LLM Settings</h2>
      <SettingsDashboard state={state} onStateChange={handleStateChange} />
    </div>
  );
}
