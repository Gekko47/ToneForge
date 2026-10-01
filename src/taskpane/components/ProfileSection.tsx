/**
 * ProfileSection — one collapsible section of the deterministic style profile.
 *
 * Spec §21. The profile editor grew four sections in this pass (language,
 * typography, formatting, structure) and a flat list of them is unreadable in a
 * narrow pane: a user opening "Deterministic Style" to change one thing has to
 * scroll past a hundred controls to find it. `<details>` rather than a custom
 * disclosure so the open state, the keyboard behaviour and the screen-reader
 * semantics are the browser's — all of which a hand-rolled version gets subtly
 * wrong.
 *
 * **The unsupported marking is the point.** A section the host cannot read is
 * still editable, because the host may be replaced, and a user who cannot set
 * their house standard because they are on Word on the web today would be stuck
 * with it permanently. What must not happen is the section looking exactly like
 * a working one: a user who configures a table style and never sees a finding
 * would conclude the table is compliant, and it was never examined. So the
 * section says so, in the section rather than in a tooltip.
 */

import React from "react";

export interface ProfileSectionProps {
  id: string;
  title: string;
  /** One sentence on what this section decides. */
  summary: string;
  children: React.ReactNode;
  /**
   * Whether the host this profile will run against can read the content.
   *
   * `null` means "not known yet" — the capability probe has not run — which is
   * a third state and not a synonym for `true`. Marking a section unsupported
   * before the probe has answered would be a claim about the host nobody made.
   */
  supported?: boolean | null;
  /** Why it is unsupported, in the user's terms. */
  unsupportedReason?: string;
  /** Open on first render. Only the section a user is most likely to want. */
  defaultOpen?: boolean;
}

export default function ProfileSection({
  id,
  title,
  summary,
  children,
  supported = null,
  unsupportedReason,
  defaultOpen = false,
}: ProfileSectionProps): React.ReactNode {
  const headingId = `${id}-heading`;
  return (
    <details className="tf-profile-section" open={defaultOpen}>
      <summary className="tf-profile-section-summary">
        <span className="tf-profile-section-title" id={headingId}>
          {title}
        </span>
        {supported === false && (
          <span className="tf-profile-section-unsupported" title={unsupportedReason}>
            Not checked in this Word version
          </span>
        )}
      </summary>
      <div className="tf-profile-section-body">
        <p className="tf-sub">{summary}</p>
        {supported === false && (
          <p className="tf-coverage-blocked" role="note">
            {unsupportedReason ??
              "This Word version does not serve the content this section governs, so a standard set here is stored but never compared. Everything else on this page still applies."}
          </p>
        )}
        <div className="tf-profile-section-fields">{children}</div>
      </div>
    </details>
  );
}
