import React from "react";
import { DefaultButton, MessageBar, MessageBarType, PrimaryButton } from "@fluentui/react";
import {
  activatePublished,
  discardDraft,
  effectiveProfile,
  publishDraft,
  recallRevisionAsDraft,
  restoreAsDraft,
  type ProfileRecord,
} from "../../core/domain/ProfileRecord";
import ProfileHistoryCompare from "./ProfileHistoryCompare";

export interface ProfileRecordSectionProps {
  record: ProfileRecord;
  onChange: (record: ProfileRecord) => void;
  /**
   * Where this section's announcements go, when the page already has a region.
   *
   * **Optional, and the absence is the meaningful case.** On the deterministic
   * Profile page this section is the only thing that speaks, so it owns its own
   * polite region. On a page that already has one — ADR-0062 says a pane has
   * exactly one, and the Semantic Style page has had its own since the split —
   * a second `role="status"` would make two regions update in the same tick and
   * a screen reader would read them in DOM order rather than in the order the
   * events happened. That is the precise failure ADR-0062 was written to stop,
   * so a page that owns a region passes its setter here and this component
   * stops rendering one.
   */
  onAnnounce?: (message: string) => void;
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
 * interrupted on every render — or none, when `onAnnounce` hands the sentence to
 * a page that already owns one.
 */
export default function ProfileRecordSection({
  record,
  onChange,
  onAnnounce,
}: ProfileRecordSectionProps): React.ReactNode {
  const [announcement, setAnnouncement] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /**
   * Whether the full revision audit trail is expanded.
   *
   * Collapsed by default. A long-lived record accumulates a revision per save,
   * and rendering all of them pushed the editor's own controls below the fold.
   * Collapsed is the right default because the draft and the active published
   * version — the two things a user came to this tab for — are above it.
   */
  const [showAllRevisions, setShowAllRevisions] = React.useState(false);

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
    const message = `${detail} Now at revision ${next.nextRevision - 1}.`;
    if (onAnnounce === undefined) setAnnouncement(message);
    else onAnnounce(message);
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

  function handleRecall(revision: number): void {
    try {
      commit(
        recallRevisionAsDraft(record, revision, new Date().toISOString()).record,
        `Revision ${revision} recalled as a draft. Publish it to check documents against it.`,
      );
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
        <p className="tf-sub">
          No published versions yet. Until you publish a draft, documents are checked against the
          draft, and there is no published version to restore from — use <strong>Recall</strong> in
          the revision audit trail below to bring any earlier revision back as a new draft.
        </p>
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
                    className="tf-native-button"
                    type="button"
                    onClick={() => handleActivate(entry.revision)}
                    aria-label={`Activate published revision ${entry.revision}`}
                  >
                    Activate
                  </button>
                )}
                <button
                  className="tf-native-button"
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
        <p className="tf-sub">
          Every recorded revision keeps a full copy of the profile. Recall copies one back into a
          new draft; it does not activate anything, so publishing stays an explicit second step.
        </p>
        {/*
          The trail is collapsed by default and the count is stated before it is
          hidden. A record with twenty revisions pushed the Typography and House
          style controls below the fold, and a list nobody scrolls to is the
          same as a list that is not there — so the count is always visible even
          when the rows are not.
        */}
        {revisions.length > 0 && (
          <button
            type="button"
            className="tf-native-button tf-collapsible-header"
            aria-expanded={showAllRevisions}
            onClick={() => setShowAllRevisions((open) => !open)}
          >
            {showAllRevisions ? "Hide revisions" : "Show all revisions"}{" "}
            <span>{revisions.length}</span>
          </button>
        )}
        {revisions.length === 0 ? (
          <p className="tf-sub">No revisions recorded yet.</p>
        ) : !showAllRevisions ? null : (
          <ol aria-label="Revision audit trail" className="tf-revision-list">
            {revisions.map((entry) => {
              const isCurrentDraft = record.draft?.revision === entry.revision;
              return (
                <li
                  key={`${entry.revision}-${entry.action}-${entry.at}`}
                  className="tf-published-item"
                >
                  <span>
                    Revision {entry.revision} · {dateLabel(entry.at)} · {entry.detail}
                  </span>
                  <button
                    className="tf-native-button"
                    type="button"
                    onClick={() => handleRecall(entry.revision)}
                    disabled={isCurrentDraft}
                    aria-label={`Recall revision ${entry.revision} as a new draft`}
                    title={
                      isCurrentDraft
                        ? "This revision is already the current draft."
                        : "Copy this revision into a new editable draft."
                    }
                  >
                    Recall
                  </button>
                </li>
              );
            })}
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

      {/*
        Rendered only when this component owns the page's region. A caller with
        its own live region passes `onAnnounce` and this div must not appear, or
        the pane has two regions that update independently.
      */}
      {onAnnounce === undefined && (
        <div role="status" aria-live="polite" className="tf-sub">
          {announcement}
        </div>
      )}
      {error && (
        <MessageBar messageBarType={MessageBarType.error} role="alert">
          {error}
        </MessageBar>
      )}
    </section>
  );
}
