/**
 * SemanticProfilePicker — choose, create, and delete semantic profiles.
 *
 * The persistence layer already had every writer this needs —
 * `selectKindRecordList`, `setActiveSemanticProfile`, `createSemanticProfileRecord`,
 * `removeSemanticProfile` — and none of them had a caller. The Semantic tab could
 * only ever show the one profile Learn Style had just made, so a user who wanted
 * a second voice, or wanted to start from a blank profile rather than a sample,
 * had no way to get there and no way to undo one they did not want.
 *
 * "Create empty" is not a convenience. Learn Style requires a sample that passes
 * the quality gate, so without it the tab is unreachable for anyone whose
 * document is too short, and the one route in runs a model over their prose.
 */
import React from "react";
import { Button } from "@fluentui/react-components";
import { useConfirmDialog } from "./common/ConfirmDialog";
import type { ProfileSummary } from "../../core/state/profileSelectors";
import type { ProfileRecord } from "../../core/domain/ProfileRecord";

export interface SemanticProfilePickerProps {
  /** Every semantic profile, newest activity first. */
  records: ProfileSummary[];
  /** The profile currently in effect, or null when there is none. */
  activeId: string | null;
  /** The active record, for its name and revision in the summary line. */
  activeRecord: ProfileRecord | null;
  onSelect: (id: string) => void;
  onCreateEmpty: () => void;
  onDelete: (id: string) => void;
}

export default function SemanticProfilePicker({
  records,
  activeId,
  activeRecord,
  onSelect,
  onCreateEmpty,
  onDelete,
}: SemanticProfilePickerProps): React.ReactNode {
  const { confirm, dialog } = useConfirmDialog();

  /*
   * Deleting a profile is destructive and irreversible, so it confirms first
   * (spec §19, ADR-0133). The dialog is rendered inside this section rather
   * than portalled to the pane root: it is scoped to the list it acts on, and
   * the shared helper still focus-traps and dismisses on Escape.
   */
  async function confirmDelete(record: ProfileSummary): Promise<void> {
    const confirmed = await confirm({
      title: `Delete "${record.name}"?`,
      message:
        "This removes the semantic profile and its published revisions. It cannot be undone.",
      confirmLabel: "Delete profile",
      danger: true,
    });
    if (confirmed) {
      onDelete(record.id);
    }
  }

  return (
    <section aria-labelledby="semantic-profiles-heading">
      {dialog}
      <h2 id="semantic-profiles-heading">Semantic profiles</h2>
      <p className="tf-sub">
        A semantic profile says how the writing should sound. The rewrite is asked to match
        whichever one is active here.
      </p>

      {records.length === 0 ? (
        <p className="tf-sub">
          No semantic profiles yet. Create one below, or learn one from a sample.
        </p>
      ) : (
        <ul aria-label="Semantic profiles" className="tf-published-list">
          {records.map((record) => {
            const active = record.id === activeId;
            return (
              <li key={record.id}>
                <span>
                  {record.name}
                  {record.publishedCount > 0 ? ` (${record.publishedCount} published)` : ""}
                </span>
                {active ? (
                  <span className="tf-published-active">
                    Active
                    <span className="sr-only"> — {record.name}</span>
                  </span>
                ) : (
                  /*
                   * The profile's name rides in the accessible name, not just
                   * visually. Two buttons both reading "Use this one" tell a
                   * screen reader user nothing about which one they are on, and
                   * a list of them is not a list they can navigate.
                   */
                  <Button onClick={() => onSelect(record.id)}>
                    Use this one<span className="sr-only"> — {record.name}</span>
                  </Button>
                )}
                {/*
                  Deleting the only profile is offered, and lands the pane back on
                  the "no profile" state rather than stranding it. A control that
                  refuses the one action that would leave the user stuck is worse
                  than one that lets them back out.
                */}
                <Button onClick={() => void confirmDelete(record)}>
                  Delete<span className="sr-only"> {record.name}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="tf-actions">
        <Button onClick={onCreateEmpty}>Create empty profile</Button>
      </div>

      {activeRecord !== null && (
        <p className="tf-sub">
          Active: {activeRecord.name}, revision {activeRecord.draft?.revision ?? 0}.
        </p>
      )}
    </section>
  );
}
