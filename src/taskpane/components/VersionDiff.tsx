import React from "react";
import type { StyleProfile } from "../../core/domain/StyleProfile";
import type { GovernanceProfile } from "../../core/domain/GovernanceProfile";
import {
  diffGovernanceProfiles,
  diffProfiles,
  formatChangelog,
  formatGovernanceChangelog,
} from "../../style/versioning";
import { DiffCardList } from "./common/DiffCardList";

interface VersionDiffProps {
  savedProfile: StyleProfile | null;
  currentProfile: StyleProfile | null;
  savedGovernanceProfile?: GovernanceProfile | null;
  currentGovernanceProfile?: GovernanceProfile | null;
}

function diffNotice(message: string): React.ReactNode {
  return (
    <p className="tf-sub" role="status" aria-live="polite" data-testid="version-diff-message-text">
      {message}
    </p>
  );
}

/**
 * The unsaved-change preview. Both the style and governance diffs render as
 * card lists rather than tables (plan §2.3/§33), so the comparison stays
 * readable in a pane docked to 320px.
 */
export default function VersionDiff({
  savedProfile,
  currentProfile,
  savedGovernanceProfile = null,
  currentGovernanceProfile = null,
}: VersionDiffProps): React.ReactNode {
  const governanceDiff =
    savedGovernanceProfile && currentGovernanceProfile
      ? diffGovernanceProfiles(savedGovernanceProfile, currentGovernanceProfile)
      : null;

  if (!savedProfile) {
    return diffNotice("Save this profile to establish a baseline for change previews.");
  }

  if (!currentProfile) {
    return diffNotice("Resolve validation errors to preview profile changes.");
  }

  const styleDiff = diffProfiles(savedProfile, currentProfile);
  if (styleDiff.changedCount === 0 && (governanceDiff?.changedCount ?? 0) === 0) {
    return diffNotice("No unsaved profile changes.");
  }

  return (
    <section aria-labelledby="version-diff-heading" aria-live="polite">
      <h2 id="version-diff-heading">Unsaved profile changes</h2>
      <p className="tf-sub">This preview compares the current draft with the last saved profile.</p>
      {styleDiff.changedCount > 0 && (
        <>
          <DiffCardList
            caption={`${styleDiff.changedCount} field change(s)`}
            leftLabel="Last saved"
            rightLabel="Current draft"
            changes={styleDiff.changes}
          />
          <p className="tf-sub">{formatChangelog(styleDiff)}</p>
        </>
      )}
      {savedGovernanceProfile && currentGovernanceProfile && governanceDiff?.changedCount ? (
        <section aria-labelledby="governance-version-diff-heading" aria-live="polite">
          <h2 id="governance-version-diff-heading">Governance policy changes</h2>
          <p className="tf-sub">
            Policy revision {savedGovernanceProfile.version} to {currentGovernanceProfile.version}.
          </p>
          <DiffCardList
            caption="Governance policy diff"
            leftLabel="Last saved"
            rightLabel="Current draft"
            changes={governanceDiff.changes}
          />
          <p className="tf-sub">{formatGovernanceChangelog(governanceDiff)}</p>
        </section>
      ) : null}
    </section>
  );
}
