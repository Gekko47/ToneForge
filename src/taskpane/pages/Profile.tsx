import React from "react";
import ProfileEditor from "../components/ProfileEditor";

export interface ProfileProps {
  onBack: () => void;
}

export default function Profile({ onBack }: ProfileProps): React.ReactNode {
  return (
    <div className="tf-card" data-page="profile">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button type="button" onClick={onBack}>
          Back to Document Governance
        </button>
      </nav>
      <h1 className="tf-title">Style profile</h1>
      <p className="tf-sub">Manage the active profile, its version, and applied document scope.</p>
      <ProfileEditor />
    </div>
  );
}
