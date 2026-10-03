/**
 * FindingGroupCard — one occurrence group, offered as a single identified set.
 *
 * **What this closes.** Spec §13 computes a batch-safety verdict per group and
 * §15 asks for the control that respects it; the engine produced both and nothing
 * rendered them, which is why the batch-approval module was dead code (ND-7) and
 * `report.groups` was discarded (ND-9). The verdict is not re-derived here — this
 * component renders the engine's own `safeBatchApproval` and its own
 * `batchRefusalReason`, so a group the engine refused cannot be approved by a
 * second opinion of this file's making.
 *
 * **Three properties the owner asked for (D6), and how each is held.**
 *
 * - *User opt-in.* Nothing here runs on render or on scan. `onApproveAll` and
 *   `onSkipAll` fire only from a press, so a group is never approved because the
 *   engine grouped it well.
 * - *Presented as one identified set.* The header names the category and the
 *   correction, so "Accept all" is a decision about a described set rather than
 *   about a count.
 * - *A refusal is stated.* Approve-all is rendered disabled and `aria-describedby`
 *   points at the engine's own sentence. Hiding the control would leave the reader
 *   unable to tell "one at a time" from "not offered"; disabling it silently is the
 *   failure ADR-0069 exists to prevent.
 *
 * **Collapsed by default.** A group of fourteen occurrences expanded pushes the
 * other findings off screen, and the common reading task is "what kinds of problem
 * are here" rather than "read all fourteen". Expanding is one press and does not
 * lose anything.
 *
 * **The all-or-nothing rule belongs to the caller.** `batchApproval.approveGroup`
 * decides whether pressing this records every occurrence or none; this component
 * states the button's availability and reports the outcome. Two implementations of
 * the rule would eventually disagree, and the disagreement would be "the pane said
 * fourteen are approved and Pending changes holds three".
 */

import React from "react";
import type { DeterministicFindingGroup } from "../../analysis/deterministic/contracts";
import { describeGroup, undecidedIn } from "../findingGroups";
import type { Finding } from "../../core/domain/Finding";
import { batchApprovalLabel } from "../batchApproval";
import { reviewIdentity } from "../occurrenceIdentity";
import FindingCard from "./FindingCard";

export interface FindingGroupCardProps {
  group: DeterministicFindingGroup;
  /** The group's occurrences in this run, in document order. */
  findings: Finding[];
  /** Occurrence ids the group named that this run did not produce. */
  missing?: number;
  /** Occurrence identities already decided, so the header counts what is left. */
  decidedKeys?: ReadonlySet<string> | undefined;
  /** Findings keyed by id, for the undecided count. Built once by the parent. */
  byId?: ReadonlyMap<string, Finding> | undefined;
  /** Where this group's first occurrence sits in the toolbar's index numbering. */
  startIndex: number;
  selectedIndex?: number | null | undefined;
  onApproveAll?: ((group: DeterministicFindingGroup) => void) | undefined;
  onSkipAll?: ((group: DeterministicFindingGroup) => void) | undefined;
  onReview?: ((finding: Finding) => void) | undefined;
  onIgnore?: ((findingId: string) => void) | undefined;
  onSkip?: ((finding: Finding) => void) | undefined;
  onUndo?: ((finding: Finding) => void) | undefined;
  approveRefusal?: ((finding: Finding) => string | null) | undefined;
  reviewedKeys?: ReadonlySet<string> | undefined;
  skippedKeys?: ReadonlySet<string> | undefined;
  /** Open on arrival, rather than collapsed. Used by the toolbar's focus step. */
  defaultExpanded?: boolean;
}

export default function FindingGroupCard({
  group,
  findings,
  missing = 0,
  decidedKeys,
  byId,
  startIndex,
  selectedIndex = null,
  onApproveAll,
  onSkipAll,
  onReview,
  onIgnore,
  onSkip,
  onUndo,
  approveRefusal,
  reviewedKeys,
  skippedKeys,
  defaultExpanded = false,
}: FindingGroupCardProps): React.ReactNode {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const headerId = `finding-group-header-${group.id}`;
  const refusalId = `finding-group-refusal-${group.id}`;
  const missingId = `finding-group-missing-${group.id}`;

  /*
   * The control's own state, read from the engine.
   *
   * `batchApprovalLabel` is the one place that turns the verdict into a label, and
   * `batchApproval` is the one place that acts on it. This component reads the
   * first and never re-derives `safeBatchApproval` — a group the engine refused
   * must be refused here too, and the only way to guarantee that is to ask.
   */
  const approve = batchApprovalLabel(group);
  const undecided =
    byId === undefined || decidedKeys === undefined
      ? findings.length
      : undecidedIn(group, byId, decidedKeys);
  const label = describeGroup(group, findings.length);

  return (
    <article className="tf-finding-group" aria-labelledby={headerId}>
      <header className="tf-finding-group-header">
        <strong id={headerId}>{label}</strong>
        {undecided < findings.length && (
          <span className="tf-sub">{` — ${undecided} still to decide`}</span>
        )}
        {missing > 0 && (
          <p id={missingId} className="tf-sub">
            {`${missing} of the occurrences this group was built from are no longer in this ` +
              `document. They are not shown and cannot be approved.`}
          </p>
        )}
      </header>

      <nav className="tf-finding-actions" aria-label={`Actions for ${group.category}`}>
        {/*
          Disabled with the engine's reason, never removed.

          `aria-describedby` points at the reason below rather than a `title`, so a
          screen-reader user meets the sentence when the control takes focus. The
          reason is rendered as visible text too — a disabled control whose only
          explanation is inside an ARIA attribute is silent for everyone else.
        */}
        <button
          className="tf-native-button"
          type="button"
          onClick={() => onApproveAll?.(group)}
          disabled={!approve.enabled || onApproveAll === undefined}
          aria-describedby={approve.enabled ? undefined : refusalId}
        >
          {approve.label}
        </button>
        <button
          className="tf-native-button"
          type="button"
          onClick={() => onSkipAll?.(group)}
          disabled={onSkipAll === undefined}
        >
          Decline all
        </button>
        <button
          type="button"
          className="tf-native-button tf-collapsible-header"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-controls={`finding-group-body-${group.id}`}
        >
          {expanded ? "Hide occurrences" : `Show ${findings.length} occurrence(s)`}
        </button>
        {!approve.enabled && (
          <span id={refusalId} className="tf-sub">
            {group.batchRefusalReason ??
              "these occurrences cannot be approved together in this document"}
          </span>
        )}
      </nav>

      {expanded && (
        <div id={`finding-group-body-${group.id}`} role="listbox" aria-label={label}>
          {findings.map((finding, offset) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              selected={startIndex + offset === selectedIndex}
              onReview={onReview}
              onIgnore={onIgnore}
              onSkip={onSkip}
              onUndo={onUndo}
              reviewed={reviewedKeys?.has(reviewIdentity(finding)) === true}
              skipped={skippedKeys?.has(reviewIdentity(finding)) === true}
              approveRefusal={approveRefusal?.(finding) ?? null}
            />
          ))}
        </div>
      )}
    </article>
  );
}
