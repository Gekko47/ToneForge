import React from "react";
import { DefaultButton, MessageBar, MessageBarType, PrimaryButton } from "@fluentui/react";
import {
  activatePublished,
  discardDraft,
  effectiveProfile,
  publishDraft,
  restoreAsDraft,
  type ProfileRecord,
} from "../../core/domain/ProfileRecord";
import ProfileHistoryCompare from "./ProfileHistoryCompare";

export interface ProfileRecordSectionProps {
  record: ProfileRecord;
  onChange: (record: ProfileRecord) => void;
}

function dateLabel(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Profile record controls and revision audit trail.
 *
 * Publishing appends an immutable version, activation is always explicit, and
 * the audit trail lists every recorded revision. Exactly one polite status
 * region is rendered, and only after an action, so assistive technology is not
 * interrupted on every render.
 */
export default function ProfileRecordSection({
  record,
  onChange,
}: ProfileRecordSectionProps): React.ReactNode {
  const [announcement, setAnnouncement] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const active = effectiveProfile(record);
  const published = record.published;
  const total = published.length;
  const firstPublished = published[0];
  const lastPublished = published[published.length - 1];
  // Newest first: the most recent revision is what a reviewer cares about.
  const revisions = [...record.revisions].reverse();

  function commit(next: ProfileRecord, detail: string): void {
    onChange(next);
    setError(null);
    setAnnouncement(`${detail} Now at revision ${next.nextRevision - 1}.`);
  }

  function handlePublish(): void {
    try {
      commit(publishDraft(record, new Date().toISOString()).record, "Draft published.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleActivate(revision: number): void {
    try {
      commit(
        activatePublished(record, revision, new Date().toISOString()).record,
        `Revision ${revision} activated.`,
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleRestore(revision: number): void {
    try {
      commit(
        restoreAsDraft(record, revision, new Date().toISOString()).record,
        `Revision ${revision} restored as a draft.`,
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleDiscard(): void {
    try {
      commit(discardDraft(record, new Date().toISOString()).record, "Draft discarded.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section aria-labelledby="profile-record-heading" className="tf-collapsible">
      <h2 id="profile-record-heading">Profile revisions</h2>
      <p className="tf-sub">
        This profile has one editable draft and a list of published versions. Published versions are
        immutable; restoring one creates a new draft. Documents are checked against the active
        published revision.
      </p>

      <p className="tf-sub" data-testid="record-summary">
        Draft: {record.draft ? `revision ${record.draft.revision}` : "none"} · Published versions:{" "}
        {total} · Active revision: {active ? active.revision : "—"}
      </p>

      <div className="tf-lifecycle-actions">
        <PrimaryButton
          onClick={handlePublish}
          disabled={!record.draft}
          text="Publish draft"
          aria-describedby="publish-draft-hint"
        />
        <DefaultButton onClick={handleDiscard} disabled={!record.draft} text="Discard draft" />
      </div>
      <p id="publish-draft-hint" className="tf-sub">
        {record.draft
          ? "Publishing creates a new immutable version and activates it."
          : "Create or edit a draft to publish a version."}
      </p>

      {total === 0 ? (
        <p className="tf-sub">No published versions yet.</p>
      ) : (
        <ul aria-label="Published versions" className="tf-published-list">
          {published.map((entry, index) => {
            const isActive = entry.revision === record.activePublishedRevision;
            return (
              <li key={entry.revision} className="tf-published-item">
                <span>
                  Revision {entry.revision} · {dateLabel(entry.at)} · version {index + 1} of {total}
                </span>
                {isActive ? (
                  <span className="tf-published-active">Active version</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleActivate(entry.revision)}
                    aria-label={`Activate published revision ${entry.revision}`}
                  >
                    Activate
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleRestore(entry.revision)}
                  aria-label={`Restore published revision ${entry.revision} as a draft`}
                >
                  Restore as draft
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <section aria-labelledby="revision-trail-heading">
        <h3 id="revision-trail-heading">Revision audit trail</h3>
        {revisions.length === 0 ? (
          <p className="tf-sub">No revisions recorded yet.</p>
        ) : (
          <ol aria-label="Revision audit trail" className="tf-revision-list">
            {revisions.map((entry) => (
              <li key={entry.revision}>
                Revision {entry.revision} · {dateLabel(entry.at)} · {entry.detail}
              </li>
            ))}
          </ol>
        )}
      </section>

      {total > 1 && firstPublished && lastPublished ? (
        <ProfileHistoryCompare
          left={firstPublished.profile}
          right={lastPublished.profile}
          leftLabel={`First published (r${firstPublished.revision})`}
          rightLabel={`Latest published (r${lastPublished.revision})`}
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
