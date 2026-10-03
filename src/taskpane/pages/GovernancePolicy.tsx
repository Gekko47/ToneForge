import React from "react";
import GovernancePolicySection from "../components/GovernancePolicySection";
import { readActiveGovernanceContext } from "../activeGovernance";
import type { GovernanceProfile } from "../../core/domain/GovernanceProfile";

export interface GovernancePolicyProps {
  onBack: () => void;
}

/**
 * The governance-policy tab.
 *
 * The policy lives here rather than on the style tab because it answers a
 * different question. The style tab says "which rules does this profile
 * enforce?"; the policy says "which of them may ToneForge fix on its own, and
 * which need a person?". They are edited together often, but a user looking
 * for one does not want to scroll past the other to find it.
 *
 * The empty state is deliberate. A policy is seeded by `saveProfileRecord`, so
 * a missing record means there is nothing to govern — saying so is better than
 * rendering a disabled form that looks like a failure.
 */
export default function GovernancePolicy({ onBack }: GovernancePolicyProps): React.ReactNode {
  /*
   * Read once, at mount.
   *
   * The page is lazily mounted when the user navigates here, so the initialiser
   * already runs on arrival — a mount effect reading the same store would
   * immediately repeat an identical lookup and observe nothing newer. The store
   * is read exactly once, and `record` is that snapshot, because nothing on this
   * page changes it.
   */
  const [context] = React.useState(readActiveGovernanceContext);
  /*
   * `policy` is the one thing that does change, and it changes the opposite way
   * from a re-read: the section persists the policy itself, so reading the store
   * after a save would restore the pre-save value the instant the user saved it.
   * `onPolicySaved` is therefore the only update path after mount.
   */
  const [policy, setPolicy] = React.useState<GovernanceProfile | null>(context.policy);

  return (
    <div className="tf-card" data-page="governance-policy">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button className="tf-native-button" type="button" onClick={onBack}>
          Back to Deterministic Review
        </button>
      </nav>
      <h1 className="tf-title">Governance Policy</h1>
      <p className="tf-sub">
        How strict each check is, and which corrections ToneForge may apply without asking.
        Mandatory checks become tracked Word revisions after you approve them. Advisory checks are
        reported and never rewritten.
      </p>
      {context.record === null || policy === null ? (
        <p className="tf-sub">
          No policy to show. A policy is created when a style profile is first saved — open the
          Deterministic Style Profile tab and save a profile.
        </p>
      ) : (
        <GovernancePolicySection policy={policy} onPolicySaved={setPolicy} />
      )}
    </div>
  );
}
