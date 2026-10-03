import React from "react";
import ProfileEditor from "../components/ProfileEditor";
import ProfileRecordSection from "../components/ProfileRecordSection";
import { readActiveGovernanceContext } from "../activeGovernance";
import { saveProfileRecord } from "../../core/state/persistence";
import type { ProfileRecord } from "../../core/domain/ProfileRecord";
import type { WordCapabilities } from "../../word/capabilityProbe";

export interface ProfileProps {
  onBack: () => void;
  /**
   * The probed Word capabilities, forwarded to the profile editor.
   *
   * The dashboard has already probed by the time this page can be reached; the
   * value is passed rather than re-probed so the sections are marked from the
   * same evidence the review used.
   */
  capabilities?: WordCapabilities | null;
}

export default function Profile({ onBack, capabilities = null }: ProfileProps): React.ReactNode {
  const [record, setRecord] = React.useState<ProfileRecord | null>(
    readActiveGovernanceContext().record,
  );

  // Re-read rather than patch local state. `saveProfileRecord` rewrites the
  // governance profile's wrapped style, so a record held in a React copy would
  // go stale the moment anything else touched the store.
  function refreshFromStore(): void {
    setRecord(readActiveGovernanceContext().record);
  }

  React.useEffect(() => {
    refreshFromStore();
  }, []);

  // Both writers below re-read rather than patching local state. `saveProfileRecord`
  // rewrites the governance profile's wrapped style, so a policy held in a React
  // copy would silently go stale after any record edit.
  function applyRecord(next: ProfileRecord): void {
    saveProfileRecord(next);
    refreshFromStore();
  }

  // The editor persists the record itself, so the page re-reads it rather than
  // keeping a copy that could overwrite the freshly saved draft later.
  function refreshRecord(_saved: ProfileRecord): void {
    refreshFromStore();
  }

  return (
    <div className="tf-card" data-page="profile">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button className="tf-native-button" type="button" onClick={onBack}>
          Back to Deterministic Review
        </button>
      </nav>
      <h1 className="tf-title">Deterministic Style Profile</h1>
      <p className="tf-sub">
        The rules ToneForge checks deterministically: typography and house style. Semantic style and
        the measured metrics these rules were derived from are shown on the Semantic tab, and the
        policy that decides which of these may be applied without asking is on the Governance Policy
        tab.
      </p>
      {record !== null && <ProfileRecordSection record={record} onChange={applyRecord} />}
      <ProfileEditor onRecordSaved={refreshRecord} capabilities={capabilities} />
    </div>
  );
}
