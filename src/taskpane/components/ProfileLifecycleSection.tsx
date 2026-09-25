import React from "react";
import { DefaultButton, MessageBar, MessageBarType, PrimaryButton } from "@fluentui/react";
import {
  activatePublished,
  discardDraft,
  effectiveProfile,
  publishDraft,
  restoreAsDraft,
  type LifecycleEvent,
  type ProfileLifecycleState,
} from "../../core/domain/ProfileLifecycle";
import { saveProfileLifecycle } from "../../core/state/index";
import ProfileHistoryCompare from "./ProfileHistoryCompare";

export interface ProfileLifecycleSectionProps {
  lifecycle: ProfileLifecycleState;
  onChange: (lifecycle: ProfileLifecycleState, event: LifecycleEvent) => void;
}

function versionLabel(major: number, minor: number, patch: number): string {
  return `v${major}.${minor}.${patch}`;
}

function publishedLabel(index: number, total: number, version: string, updatedAt: string): string {
  const ordinal = `${index + 1} of ${total}`;
  const when = new Date(updatedAt).toISOString().slice(0, 10);
  return `Version ${ordinal} · ${version} · ${when}`;
}

/**
 * Organizational profile lifecycle controls.
 *
 * Publishing appends an immutable snapshot; activation is always explicit; a
 * published version is never edited in place. Announcements are reduced to a
 * single polite status region so screen readers are not flooded by a live
 * region per control.
 */
export default function ProfileLifecycleSection({
  lifecycle,
  onChange,
}: ProfileLifecycleSectionProps): React.ReactNode {
  const [announcement, setAnnouncement] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const now = (): string => new Date().toISOString();
  const active = effectiveProfile(lifecycle);
  const published = lifecycle.published;
  const total = published.length;
  const lastIndex = total - 1;

  function commit(next: ProfileLifecycleState, event: LifecycleEvent): void {
    saveProfileLifecycle(next);
    setError(null);
    setAnnouncement(`${event.detail} Revision ${next.revision}.`);
    onChange(next, event);
  }

  function handlePublish(): void {
    try {
      const result = publishDraft(lifecycle, now());
      commit(result.state, result.event);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleActivate(publishedId: string): void {
    try {
      const result = activatePublished(lifecycle, publishedId, now());
      commit(result.state, result.event);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleRestore(publishedId: string): void {
    try {
      const result = restoreAsDraft(lifecycle, publishedId, now());
      commit(result.state, result.event);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleDiscard(): void {
    const result = discardDraft(lifecycle, now());
    commit(result.state, result.event);
  }

  return (
    <section aria-labelledby="profile-lifecycle-heading" className="tf-collapsible">
      <h2 id="profile-lifecycle-heading">Profile lifecycle</h2>
      <p className="tf-sub">
        A profile has one editable draft and a list of published versions. Published versions are
        immutable; editing one restores it as a new draft. Only the active published version drives
        document analysis.
      </p>

      <p className="tf-sub" data-testid="lifecycle-summary">
        Draft: {lifecycle.draft ? "present" : "none"} · Published versions: {total} · Active
        version:{" "}
        {active
          ? versionLabel(active.version.major, active.version.minor, active.version.patch)
          : "—"}
      </p>

      <div className="tf-lifecycle-actions">
        <PrimaryButton
          onClick={handlePublish}
          disabled={!lifecycle.draft}
          text="Publish draft"
          aria-describedby="publish-draft-hint"
        />
        <DefaultButton onClick={handleDiscard} disabled={!lifecycle.draft} text="Discard draft" />
      </div>
      <p id="publish-draft-hint" className="tf-sub">
        {lifecycle.draft
          ? "Publishing creates a new immutable version and activates it."
          : "Create or edit a draft to publish a version."}
      </p>

      {total === 0 ? (
        <p className="tf-sub">No published versions yet.</p>
      ) : (
        <ul aria-label="Published versions" className="tf-published-list">
          {published.map((entry, index) => {
            const isActive = entry.id === lifecycle.activePublishedId;
            return (
              <li key={`${entry.id}-${index}`} className="tf-published-item">
                <span>
                  {publishedLabel(
                    index,
                    total,
                    versionLabel(entry.version.major, entry.version.minor, entry.version.patch),
                    entry.updatedAt,
                  )}
                </span>
                {isActive ? (
                  <span className="tf-published-active">Active version</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleActivate(entry.id)}
                    aria-label={`Activate published version ${index + 1} of ${total}`}
                  >
                    Activate
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleRestore(entry.id)}
                  aria-label={`Restore published version ${index + 1} of ${total} as a draft`}
                >
                  Restore as draft
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {total > 1 && lastIndex > 0 && published[0] && published[lastIndex] ? (
        <ProfileHistoryCompare
          left={published[0]}
          right={published[lastIndex]}
          leftLabel="First published"
          rightLabel="Latest published"
        />
      ) : null}

      <div role="status" aria-live="polite" className="tf-sub">
        {announcement}
      </div>
      {error && (
        <MessageBar messageBarType={MessageBarType.error} role="alert">
          {error}
        </MessageBar>
      )}
    </section>
  );
}
