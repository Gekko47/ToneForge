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
  /**
   * The individual standards in this section this host cannot read, when the
   * rest of the section still works.
   *
   * **Why this is separate from `supported`.** A section that governs the body
   * style, the list style, the table style, the header style and page setup is
   * not all-or-nothing: a host with no `document.tables` still reads the body
   * perfectly. Collapsing that to one boolean produced two false statements in
   * opposite directions — "not checked" on an editor that works, and silence
   * on the editors that do not. So the section is marked *partly* checked and
   * names which parts, in the section, where the standards are.
   */
  uncheckedStandards?: readonly { label: string; reason: string }[];
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
  uncheckedStandards = [],
  defaultOpen = false,
}: ProfileSectionProps): React.ReactNode {
  const headingId = `${id}-heading`;
  /*
   * The whole-section marking wins when it applies: a section that cannot read
   * anything it governs is a stronger and simpler statement than a list of what
   * it misses. Both are rendered only after the probe has answered, because a
   * claim about the host before anyone probed is a claim nobody made.
   */
  const whollyUnsupported = supported === false;
  const partlyUnsupported =
    !whollyUnsupported && supported !== null && uncheckedStandards.length > 0;
  const marker = whollyUnsupported
    ? { className: "tf-profile-section-unsupported", text: "Not checked in this Word version" }
    : partlyUnsupported
      ? {
          className: "tf-profile-section-unsupported tf-profile-section-partial",
          text: `Partly checked — ${uncheckedStandards.length} standard${uncheckedStandards.length === 1 ? "" : "s"} not read here`,
        }
      : null;

  return (
    <details className="tf-profile-section" open={defaultOpen}>
      <summary className="tf-profile-section-summary">
        <span className="tf-profile-section-title" id={headingId}>
          {title}
        </span>
        {marker && (
          <span
            className={marker.className}
            title={
              whollyUnsupported
                ? unsupportedReason
                : uncheckedStandards.map((entry) => `${entry.label}: ${entry.reason}`).join("\n")
            }
          >
            {marker.text}
          </span>
        )}
      </summary>
      <div className="tf-profile-section-body">
        <p className="tf-sub">{summary}</p>
        {whollyUnsupported && (
          <p className="tf-coverage-blocked" role="note">
            {unsupportedReason ??
              "This Word version does not serve the content this section governs, so a standard set here is stored but never compared. Everything else on this page still applies."}
          </p>
        )}
        {partlyUnsupported && (
          <ul className="tf-profile-section-limits" aria-label="Not read in this Word version">
            {uncheckedStandards.map((entry) => (
              <li key={entry.label} className="tf-coverage-blocked">
                <strong>{entry.label}:</strong> {entry.reason}
              </li>
            ))}
          </ul>
        )}
        <div className="tf-profile-section-fields">{children}</div>
      </div>
    </details>
  );
}
