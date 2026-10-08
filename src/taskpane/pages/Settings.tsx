import React from "react";
import { loadState, saveState, type PersistedState } from "../../core/state/index";
import { SettingsDashboard } from "../components/SettingsDashboard";

export interface SettingsProps {
  onBack: () => void;
}

export default function Settings({ onBack }: SettingsProps): React.ReactNode {
  const [state, setState] = React.useState<PersistedState>(() => loadState());

  function handleStateChange(next: PersistedState): void {
    setState(next);
    saveState(next);
  }

  return (
    <div className="tf-card" data-page="settings">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button className="tf-native-button" type="button" onClick={onBack}>
          Back to Deterministic Review
        </button>
      </nav>
      <h2 className="tf-title">Settings</h2>
      <SettingsDashboard state={state} onStateChange={handleStateChange} />
    </div>
  );
}
