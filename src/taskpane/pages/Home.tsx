import React from "react";
import type { TaskPaneDestination } from "../components/TaskPaneHeader";
import { type SetupItem, type SetupStatus } from "../setupStatus";

export interface HomeProps {
  /** The checklist, computed by the caller from persisted state. */
  setup: SetupStatus;
  onNavigate: (destination: TaskPaneDestination) => void;
  /**
   * Not used here, and deliberately absent.
   *
   * An earlier draft took a callback and rendered a "Create profile" button that
   * invoked it, but the button has no job: the profile editor is a page of its
   * own, and a callback that pretended to create a profile without doing so was
   * a control that lied. The checklist links to the page instead.
   */
  onProfileCreated?: () => void;
}

/**
 * The landing page.
 *
 * **It reports; it does not gate.** The previous first-run screen embedded the
 * profile editor and made every other destination unreachable, so a user who
 * wanted to read the AI consent, change the theme, or inspect Troubleshooting
 * before committing to anything could not. This page states what is outstanding
 * and what each item is currently preventing, and links to the control that
 * fixes it.
 *
 * Every warning here is phrased as what is *unavailable*, never as what becomes
 * available. The pane's real gates still decide what can run; this page is
 * telling the user why something is not running yet, and pointing at the
 * button.
 */
export default function Home({ onNavigate, setup }: HomeProps): React.ReactNode {
  const outstanding = setup.items.filter((item) => !item.ready);
  const done = setup.items.filter((item) => item.ready);

  return (
    <div className="tf-card" data-page="home">
      <h1 className="tf-title">ToneForge</h1>
      {setup.complete ? (
        <p className="tf-sub">
          Everything is set up. Deterministic review is on the Deterministic Review tab; semantic
          review is on the Semantic Review page and the style it uses is on Semantic Style.
        </p>
      ) : (
        <>
          <p className="tf-sub">
            Three things can be set up independently, and each one only affects the work it belongs
            to. Nothing here is a wall — you can read the AI permissions, change the theme, and
            inspect Troubleshooting before you create anything.
          </p>
          <ul className="tf-setup-list" aria-label="Setup checklist">
            {[...outstanding, ...done].map((item) => (
              <SetupRow key={item.id} item={item} onNavigate={onNavigate} />
            ))}
          </ul>
        </>
      )}

      {setup.blocksScanning ? (
        <section aria-labelledby="home-scanning-heading" className="tf-readiness">
          {/* No `tf-sub`: a body class on a heading renders it as body text.
              The element ramp gives it the section size it is actually for. */}
          <h2 id="home-scanning-heading">While there is no deterministic style profile</h2>
          <p>
            This document is not scanned and no correction can be applied, because every
            deterministic check is measured against a style profile. Once one exists, scanning
            starts on its own.
          </p>
          <button className="tf-native-button" type="button" onClick={() => onNavigate("profile")}>
            Create a deterministic style profile
          </button>
          <p className="tf-sub">The editor saves a profile as soon as you press Save profile.</p>
        </section>
      ) : null}

      {/*
        No "where to go" list.

        An earlier draft repeated every destination here as a second set of
        buttons beside the header's navigation. Two controls with the same
        labels doing the same thing is a maintenance hazard, and it makes the
        header's own panel look broken when the duplicate is the one that was
        clicked. The checklist rows already link to the pages that need them, and
        the header reaches the rest.
      */}
      {setup.complete ? (
        <section aria-labelledby="home-done-heading">
          <h2 id="home-done-heading">Nothing is outstanding</h2>
          <p>
            Deterministic review is on the Deterministic Review tab, semantic review is on Semantic
            Review, and the style it uses is on Semantic Style. All are one click away in the
            navigation above.
          </p>
        </section>
      ) : null}
    </div>
  );
}

/**
 * One checklist row.
 *
 * A ready item is present rather than removed. Three rows where one of them can
 * change back is a different surface from a list that shrinks, and a shrinking
 * list gives no indication that anything is still outstanding.
 */
function SetupRow({
  item,
  onNavigate,
}: {
  item: SetupItem;
  onNavigate: (destination: TaskPaneDestination) => void;
}): React.ReactNode {
  return (
    <li
      className={item.ready ? "tf-setup-row is-ready" : "tf-setup-row tf-setup-row-blocked"}
      data-testid={`tf-setup-${item.id}`}
      data-ready={item.ready ? "true" : "false"}
    >
      {/*
        The status is a real heading rather than an `aria-label` on the row: a
        list item has no role to hang a label on, so an `aria-label` there is
        ignored and the row is announced as an unlabelled list entry. A heading
        plus a visible status word is what a screen reader actually reads.
      */}
      <div className="tf-setup-row-head">
        <h3 className="tf-setup-row-label">
          {item.label}: {item.ready ? "ready" : "not set up"}
        </h3>
        <span className="tf-sub">{item.ready ? "Ready" : "Not set up"}</span>
      </div>
      <p className="tf-sub">{item.blocked ?? "Nothing is blocked by this."}</p>
      {item.ready ? null : (
        <button
          className="tf-native-button"
          type="button"
          onClick={() => onNavigate(item.destination)}
          aria-describedby={`tf-setup-control-${item.id}`}
        >
          Set up {item.label.toLowerCase()}
        </button>
      )}
      {/*
        `item.control` alone. It already reads "Deterministic Style Profile →
        Save profile", so prefixing the destination produced
        "Deterministic Style Profile → Deterministic Style Profile → Save
        profile" — the same page named twice in the sentence describing the
        button, which is the opposite of pointing at it.
      */}
      <p id={`tf-setup-control-${item.id}`} className="tf-sub">
        {item.control}
      </p>
    </li>
  );
}
