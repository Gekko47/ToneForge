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
 * **Why `<details>` again, and not a Fluent `Accordion`.** The sibling
 * `ProfileSection` deliberately uses the native disclosure element so the open
 * state, the keyboard behaviour and the screen-reader semantics are the
 * browser's. Replacing it with a JavaScript-driven `Accordion` would trade a
 * guarantee for a component, and the specific risk is concrete: Fluent v8's
 * `Accordion` implements its own expand/collapse and ARIA wiring, so every
 * behavioural property this component currently inherits for free becomes
 * something to re-implement and to re-test. `<details>` nesting is valid HTML —
 * a disclosure inside a disclosure is exactly how a grouped form is meant to be
 * marked up — and it needs no state, no effect and no ref.
 *
 * The sub-section carries no capability marking of its own. Host capability is a
 * property of the whole section, and duplicating it per sub-section would
 * produce several claims where one is true. `ProfileSection` owns that.
 */

import React from "react";

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
  return (
    <details className="tf-profile-subsection" open={defaultOpen}>
      <summary className="tf-profile-subsection-summary">
        <span className="tf-profile-subsection-title" id={`${id}-heading`}>
          {title}
        </span>
      </summary>
      <div className="tf-profile-subsection-body">
        {summary !== undefined && <p className="tf-sub">{summary}</p>}
        {children}
      </div>
    </details>
  );
}
