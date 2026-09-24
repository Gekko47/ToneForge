import React from "react";
import SettingsForm from "../components/SettingsForm";

export interface SettingsProps {
  onBack: () => void;
}

export default function Settings({ onBack }: SettingsProps): React.ReactNode {
  return (
    <div className="tf-card" data-page="settings">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button type="button" onClick={onBack}>
          Back to Document Governance
        </button>
      </nav>
      <SettingsForm />
    </div>
  );
}
