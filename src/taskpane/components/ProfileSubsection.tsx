/**
 * ProfileSubsection — a collapsible group *inside* a `ProfileSection`.
 *
 * **Why this exists.** The Language section is seven distinct conventions —
 * terminology, capitalisation, abbreviations, numbers, dates, currency, units —
 * presented as one flat run of ~430 lines. A user opening Deterministic Style to
 * change one number format has to scroll past every other convention to reach
 * it, and there is no way to tell from the top of the section which part they
 * are in. That is the "collapsible" half of UX-4, and it is a navigation
 * problem rather than a styling one.
 *
 * Rendered as a DisclosurePanel so the open state, keyboard behaviour, and
 * screen-reader semantics are Fluent's. Nested inside a ProfileSection's own
 * DisclosurePanel — separate Accordion instances, so contexts do not collide.
 *
 * The sub-section carries no capability marking of its own. Host capability is a
 * property of the whole section, and duplicating it per sub-section would
 * produce several claims where one is true. `ProfileSection` owns that.
 */

import React from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { DisclosurePanel } from "./common";

const useStyles = makeStyles({
  root: {
    marginTop: tokens.spacingVerticalS,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    paddingTop: tokens.spacingVerticalS,
  },
  body: {
    padding: `${tokens.spacingVerticalSNudge} 0 ${tokens.spacingVerticalXS}`,
  },
});

export interface ProfileSubsectionProps {
  /** Names the disclosure. Unique within the page; used for the heading id. */
  id: string;
  title: string;
  /**
   * One line on what this group decides.
   *
   * Rendered inside the disclosure rather than in the title, because the title
   * has to stay short enough to scan in a collapsed pane.
   */
  summary?: string;
  children: React.ReactNode;
  /**
   * Open on first render.
   *
   * Given to the group a user is most likely to want, and to at most one group
   * per section — a section where every sub-section is open is the flat list
   * this component exists to replace.
   */
  defaultOpen?: boolean;
}

export default function ProfileSubsection({
  id,
  title,
  summary,
  children,
  defaultOpen = false,
}: ProfileSubsectionProps): React.ReactNode {
  const styles = useStyles();
  return (
    <DisclosurePanel
      title={title}
      id={id}
      as="h3"
      defaultOpen={defaultOpen}
      className={styles.root}
    >
      <div className={styles.body}>
        {summary !== undefined && <p className="tf-sub">{summary}</p>}
        {children}
      </div>
    </DisclosurePanel>
  );
}
