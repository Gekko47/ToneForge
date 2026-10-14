/**
 * FindingTypeList — flat type rows, all at one visible level.
 *
 * Each row is a button (not a collapsible heading) that opens the one-finding
 * overlay for that type. There is no disclosure per group and no nesting, so
 * every type sits at the same level and the list reads as "what kinds of problems
 * are here" — the same shape as Word's Editor proofing pane.
 *
 * The row carries two lines: the rule's name as the heading, and the parent
 * domain as a smaller, non-bold subtext beneath it. The category a finding
 * prints is a key (`typography.whitespace`), not a sentence, so the heading
 * says what the group is in the reader's own words and the parent says which
 * part of the profile it belongs to.
 *
 * Reused by the live findings list and the Ignored findings section, so both
 * surfaces render identically.
 */

import React from "react";
import { Button } from "@fluentui/react-components";
import type { FindingTypeGroup } from "../findingsByType";
import { toneForgeIcons } from "../theme/icons";

export interface FindingTypeListProps {
  groups: readonly FindingTypeGroup[];
  /** Called when a type row is pressed, opening the overlay for that group. */
  onSelect: (group: FindingTypeGroup) => void;
  /** Accessible label prefix for the rows, e.g. "Open findings for". */
  ariaLabelPrefix?: string;
}

export default function FindingTypeList({
  groups,
  onSelect,
  ariaLabelPrefix = "Open findings for",
}: FindingTypeListProps): React.ReactNode {
  if (groups.length === 0) return null;

  return (
    <div className="tf-finding-type-list" role="list">
      {groups.map((group) => {
        const Icon = toneForgeIcons[group.icon];
        return (
          <div key={group.key} role="listitem">
            <Button
              appearance="transparent"
              className="tf-finding-type-row"
              onClick={() => onSelect(group)}
              aria-label={`${ariaLabelPrefix} ${group.ruleName}, ${group.count} finding${group.count === 1 ? "" : "s"}`}
            >
              <span className="tf-finding-type-row-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="tf-finding-type-row-text">
                <span className="tf-finding-type-row-label">{group.ruleName}</span>
                <span className="tf-finding-type-row-parent">{group.parent}</span>
              </span>
              <span className="tf-finding-type-row-count" aria-hidden="true">
                {group.count}
              </span>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
