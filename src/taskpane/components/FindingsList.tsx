/**
 * FindingsList — displays the review as occurrence groups and standalone findings.
 *
 * A listbox rather than a plain section, because the toolbar above announces
 * "Finding 4 of 12" as the user steps through it. That announcement had nothing
 * to anchor to until the list exposed an option role and the selected card
 * exposed `aria-current`: the position changed and nothing on screen did.
 *
 * **Groups are rendered from the same run as the findings, not re-derived here.**
 * `resolveFindingGroups` joins `status.groups` — which the observer now carries
 * alongside the findings it produced — to the findings actually on screen. The
 * obvious alternative, joining the preview run's groups to the scan's findings,
 * cannot work: the two runs issue separate uuids, so every occurrence would be
 * "missing" and every group would refuse. It is the same id-to-id join that made
 * the review gate report "no correction" for findings that had one.
 *
 * **The index the toolbar steps is over findings, not units.** A group of
 * fourteen occupies fourteen positions, so `startIndex` advances by the number of
 * occurrences a unit carries. Counting units instead would make "Finding 12 of 12"
 * land on the wrong card the moment any group was not of size one.
 */

import React from "react";
import type { Finding } from "../../core/domain/Finding";
import type { DeterministicFindingGroup } from "../../analysis/deterministic/contracts";
import { reviewIdentity } from "../occurrenceIdentity";
import { resolveFindingGroups } from "../findingGroups";
import FindingCard from "./FindingCard";
import FindingGroupCard from "./FindingGroupCard";

export interface FindingsListProps {
  findings: Finding[];
  /**
   * This run's occurrence groups, in the order the engine produced them.
   *
   * Optional so a caller with no engine report — and every test that only cares
   * about cards — renders a flat list. A missing group set is not the same as an
   * empty one: `undefined` means "nothing to group by", `[]` means "the engine
   * grouped these and every group was stale".
   */
  groups?: readonly DeterministicFindingGroup[] | undefined;
  onApproveAll?: ((group: DeterministicFindingGroup) => void) | undefined;
  onSkipAll?: ((group: DeterministicFindingGroup) => void) | undefined;
  pageSize?: number;
  /** Rendered as the listbox id so the toolbar can point `aria-controls` at it. */
  id?: string;
  /** Index the findings toolbar currently points at, or `null` for none. */
  selectedIndex?: number | null;
  onReview?: ((finding: Finding) => void) | undefined;
  onIgnore?: ((findingId: string) => void) | undefined;
  /** Skip: leave this occurrence out of this review, keep it in the list. */
  onSkip?: ((finding: Finding) => void) | undefined;
  /** Undo decision: withdraw what was decided so it can be decided again. */
  onUndo?: ((finding: Finding) => void) | undefined;
  /**
   * Why a finding cannot be approved, per finding.
   *
   * Computed by the caller from `unapprovableReason` rather than derived here,
   * so the card and the review gate cannot disagree about whether a correction
   * exists. A finding with a reason still offers Skip.
   */
  approveRefusal?: ((finding: Finding) => string | null) | undefined;
  /**
   * Occurrence identities of the reviews the user has already produced.
   *
   * Occurrence identities rather than finding ids, and the reason is
   * load-bearing: the id issued by the observer's run never reappears in the
   * plan's, so an id-keyed set could never line up with what Apply writes.
   *
   * `reviewIdentity`, specifically: this is the identity the review store writes
   * and the one the review gate reads, so a different derivation here would
   * mark a reviewed card unreviewed while Apply still considered it approved.
   *
   * A set rather than a boolean: the gate records one decision per finding, and
   * a single flag would mark every card at once.
   */
  reviewedKeys?: ReadonlySet<string>;
  /** Occurrences the user has skipped, so their cards read "Skipped". */
  skippedKeys?: ReadonlySet<string>;
}

export default function FindingsList({
  findings,
  groups,
  onApproveAll,
  onSkipAll,
  pageSize = 50,
  id,
  selectedIndex = null,
  onReview,
  onIgnore,
  onSkip,
  onUndo,
  approveRefusal,
  reviewedKeys,
  skippedKeys,
}: FindingsListProps): React.ReactNode {
  const [visibleCount, setVisibleCount] = React.useState(pageSize);
  if (findings.length === 0) {
    return <p className="tf-empty">No findings detected.</p>;
  }

  const { units } = resolveFindingGroups(groups ?? [], findings);
  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const decided = new Set([...(reviewedKeys ?? []), ...(skippedKeys ?? [])]);

  /*
    The window, measured in findings and cut in units.

    Slicing `findings` would sever a group mid-way and leave its header describing
    occurrences that are no longer on screen — a count that is wrong rather than a
    count that is absent. Cutting at unit boundaries and widening to include the
    selected unit keeps both the window and the "Finding N of M" numbering true.
  */
  const window = Math.max(visibleCount, (selectedIndex ?? 0) + 1);

  /*
    Cut at unit boundaries, numbering as we go.

    The index has to be assigned *while* deciding what to show: computing a unit's
    start from a counter that the filter already advanced lands every group one
    window too far along, and — worse — makes every standalone card render
    unselected, because nothing was tracking where each one sits. One pass, one
    counter, and `startIndex`/`selected` are both read off it.
  */
  let consumed = 0;
  const shown = units.reduce<Array<{ unit: (typeof units)[number]; start: number }>>(
    (rows, unit) => {
      const size = unit.kind === "group" ? unit.findings.length : 1;
      if (consumed >= window) return rows;
      rows.push({ unit, start: consumed });
      consumed += size;
      return rows;
    },
    [],
  );

  return (
    <section aria-label="Findings list">
      {/* No `tf-sub`: that is a body class, and a count is not body copy.
          The element ramp gives this the subhead size it is being. */}
      <h3>{findings.length} finding(s)</h3>
      <div id={id} role="listbox" aria-label="Findings" aria-orientation="vertical">
        {shown.map(({ unit, start }) => {
          if (unit.kind === "group") {
            return (
              <FindingGroupCard
                key={`group-${unit.group.id}`}
                group={unit.group}
                findings={unit.findings}
                missing={unit.missing}
                byId={byId}
                decidedKeys={decided}
                startIndex={start}
                selectedIndex={selectedIndex}
                onApproveAll={onApproveAll}
                onSkipAll={onSkipAll}
                onReview={onReview}
                onIgnore={onIgnore}
                onSkip={onSkip}
                onUndo={onUndo}
                approveRefusal={approveRefusal}
                reviewedKeys={reviewedKeys}
                skippedKeys={skippedKeys}
              />
            );
          }
          return (
            <FindingCard
              key={unit.finding.id}
              finding={unit.finding}
              selected={start === selectedIndex}
              onReview={onReview}
              onIgnore={onIgnore}
              onSkip={onSkip}
              onUndo={onUndo}
              reviewed={reviewedKeys?.has(reviewIdentity(unit.finding)) === true}
              skipped={skippedKeys?.has(reviewIdentity(unit.finding)) === true}
              approveRefusal={approveRefusal?.(unit.finding) ?? null}
            />
          );
        })}
      </div>
      {consumed < findings.length && (
        <button
          className="tf-native-button"
          type="button"
          onClick={() => setVisibleCount((count) => count + pageSize)}
        >
          Show more findings ({findings.length - consumed} remaining)
        </button>
      )}
    </section>
  );
}
