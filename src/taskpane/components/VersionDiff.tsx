import React from "react";
import type { StyleProfile } from "../../core/domain/StyleProfile";
import type { GovernanceProfile } from "../../core/domain/GovernanceProfile";
import {
  diffGovernanceProfiles,
  diffProfiles,
  formatChangelog,
  formatGovernanceChangelog,
} from "../../style/versioning";

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

export default function VersionDiff({
  savedProfile,
  currentProfile,
  savedGovernanceProfile = null,
  currentGovernanceProfile = null,
}: VersionDiffProps): React.ReactNode {
  if (!savedProfile) {
    return diffNotice("Save this profile to establish a baseline for change previews.");
  }

  if (!currentProfile) {
    return diffNotice("Resolve validation errors to preview profile changes.");
  }

  const diff = diffProfiles(savedProfile, currentProfile);

  if (diff.changedCount === 0) {
    return diffNotice("No unsaved profile changes.");
  }

  return (
    <section aria-labelledby="version-diff-heading" aria-live="polite">
      <h2 id="version-diff-heading">Unsaved profile changes</h2>
      <p className="tf-sub">This preview compares the current draft with the last saved profile.</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Last saved</th>
            <th scope="col">Current draft</th>
          </tr>
        </thead>
        <tbody>
          {diff.changes.map((change) => (
            <tr key={change.field}>
              <th scope="row">{change.field}</th>
              <td>{change.from}</td>
              <td>{change.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tf-sub">{formatChangelog(diff)}</p>
      {savedGovernanceProfile && currentGovernanceProfile && (
        <section aria-labelledby="governance-version-diff-heading" aria-live="polite">
          <h2 id="governance-version-diff-heading">Governance policy changes</h2>
          <p className="tf-sub">
            Policy revision {savedGovernanceProfile.version} to {currentGovernanceProfile.version}.
          </p>
          {(() => {
            const policyDiff = diffGovernanceProfiles(
              savedGovernanceProfile,
              currentGovernanceProfile,
            );
            return policyDiff.changedCount === 0 ? (
              <p className="tf-sub">No unsaved governance policy changes.</p>
            ) : (
              <>
                <table>
                  <caption className="tf-sub">Governance policy diff</caption>
                  <thead>
                    <tr>
                      <th scope="col">Field</th>
                      <th scope="col">Last saved</th>
                      <th scope="col">Current draft</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policyDiff.changes.map((change) => (
                      <tr key={change.field}>
                        <th scope="row">{change.field}</th>
                        <td>{change.from}</td>
                        <td>{change.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="tf-sub">{formatGovernanceChangelog(policyDiff)}</p>
              </>
            );
          })()}
        </section>
      )}
    </section>
  );
}
