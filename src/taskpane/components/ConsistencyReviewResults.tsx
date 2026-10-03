/**
 * ConsistencyReviewResults — the engine's report, shown as-is.
 *
 * The design rule is that this component may not make the report look better
 * than it is. Concretely:
 *
 * - Coverage is rendered first and unconditionally, including when the result is
 *   empty. "No problems found" over a document that was only partly examined is
 *   a false reassurance, so the limitation sits above the findings, not below.
 * - Every issue shows both statements it compared, side by side. A user cannot
 *   judge a cross-report claim without seeing what was actually compared, and the
 *   model supplied the verdict, not the user.
 * - Confidence is shown as a number. Below the actionable threshold the finding
 *   is labelled advisory, because a non-deterministic engine that rewrites prose
 *   without saying so is worse than one that asks.
 * - `usedModel: false` is stated, not hidden. That run had no model judgement in
 *   it and the user is entitled to know.
 * - Repeats are collapsed, and the count of what was collapsed is stated. The
 *   cross-section checks pair statements by shared vocabulary, so one real drift
 *   between two sections arrives many times over; a list of nine rows about one
 *   disagreement reads as nine problems, and a count of nine is a claim about the
 *   document that is not true.
 * - A conflict the engine could not place in this document says so. An empty
 *   location line looks like a rendering fault, and a reader who cannot tell the
 *   difference will assume the finding is located at the top of the file.
 *
 * Each conflict renders through `FindingDetail`, the same body Document
 * Governance uses. That is what makes the two surfaces one format rather than
 * two that happen to agree today: the header, the location line, and the
 * Go to text / Review / Ignore actions are the same components, so a conflict
 * found by an AI review can be navigated to and reviewed like any other finding.
 */

import React from "react";
import {
  CONSISTENCY_ACTIONABLE_CONFIDENCE,
  collapsedCount,
  groupConsistencyIssues,
  toFinding,
  type ConsistencyIssueGroup,
  type ConsistencyReport,
} from "../../analysis/consistency";
import FindingDetail from "./FindingDetail";

export interface ConsistencyReviewResultsProps {
  report: ConsistencyReport;
  onDismiss: () => void;
}

const UNLOCATABLE_NOTE =
  "Cannot be located in the document: the engine could not place either statement in the " +
  "text it read, so there is nothing to jump to. The statements above are what it saw.";
const LOCATABLE_NOTE = "Located in the document.";

/**
 * One collapsed conflict, rendered in the shared finding format.
 *
 * The identity is the group's first issue. A group's members are the same
 * comparison reported repeatedly, so they share a location whenever any of them
 * has one; `groupConsistencyIssues` already worked out whether the group as a
 * whole is locatable, and that is the fact being reported here.
 */
function ConflictCard({
  group,
  active,
  scrollRequest,
}: {
  group: ConsistencyIssueGroup;
  /** True for the conflict the stepper is on. Marks it, it does not hide it. */
  active: boolean;
  /**
   * Counts navigation requests. Zero until the stepper has been used, so
   * mounting the first card does not move the page.
   */
  scrollRequest: number;
}): React.ReactNode {
  const lead = group.issues[0];
  if (lead === undefined) return null;
  // A real uuid, not the group key: `FindingSchema` requires one, and the key is
  // not a uuid. The key stays the React identity, which is the thing that has to
  // be stable across re-renders.
  const finding = toFinding(lead, () => crypto.randomUUID());

  /*
   * Scroll into view, not re-render.
   *
   * Stepping exists so a user can move through a long report without scrolling
   * it by hand, so moving the stepper without moving the page would leave the
   * control claiming "contradiction 7 of 20" while contradiction 2 sits at the
   * top of the screen. `nearest` rather than `center`: it should move only when
   * the target is off screen, so a step within the viewport does not throw the
   * reader back to the top of a card they were part-way through.
   */
  const cardRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    /*
     * Only after a step. Scrolling on `active` alone also fired on mount, which
     * threw a reader who arrived at the results — or who had scrolled up to read
     * the coverage lines — back to the first card without being asked to move.
     */
    if (!active || scrollRequest === 0) return;
    /*
     * Guarded on the method existing, not on the ref. `scrollIntoView` is a
     * real DOM API that jsdom does not implement and that a host WebView may
     * lack, and an unguarded call here takes down the entire results pane —
     * every conflict, not just the one being stepped to. Scrolling is a
     * convenience; the position is still announced and the card is still
     * marked, so losing it degrades rather than breaks.
     */
    cardRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [active, scrollRequest]);

  return (
    <article
      className="tf-finding-card"
      aria-label={`Consistency issue: ${group.title}`}
      ref={cardRef}
      data-active={active ? "true" : undefined}
    >
      <FindingDetail
        finding={finding}
        // The Consistency surface keeps the full header: risk and the review
        // context are the information here, not noise, which is why this is a
        // variant rather than two components (UX-3a).
        variant="consistency"
        evidence={{
          left: lead.evidence.left,
          right: lead.evidence.right,
          sectionLeft: lead.evidence.sectionLeft,
          sectionRight: lead.evidence.sectionRight,
          repeats: group.issues.length - 1,
        }}
        locationNote={[
          group.locatable ? LOCATABLE_NOTE : UNLOCATABLE_NOTE,
          `Confidence: ${Math.round(
            Math.max(...group.issues.map((issue) => issue.confidence)) * 100,
          )}%`,
          group.issues.some((issue) => issue.actionable)
            ? "Treated as a real contradiction."
            : `Below ${Math.round(
                CONSISTENCY_ACTIONABLE_CONFIDENCE * 100,
              )}% — advisory only; this will not change anything on its own.`,
        ].join(" · ")}
      />
    </article>
  );
}

export default function ConsistencyReviewResults({
  report,
  onDismiss,
}: ConsistencyReviewResultsProps): React.ReactNode {
  const { coverage, issues } = report;
  const groups = groupConsistencyIssues(issues);
  const collapsed = collapsedCount(groups);

  /*
   * Stepping, and one announcement for it.
   *
   * `position` is the conflict the user is on, and `announced` is what the live
   * region says. They are separate because a burst of clicks would otherwise
   * update the region once per click and a screen reader would read three
   * positions for one gesture. The request counter means only the last click in
   * a burst has anything to say — the intermediate ones were never destinations,
   * and reporting them would report movement the user never asked to be told
   * about. The same rule the navigation guard applies to host moves.
   */
  const [position, setPosition] = React.useState(0);
  const requests = React.useRef(0);
  // What the live region says, and the request it was said for. Rendering only
  // when `announced.at === requests.current` is what makes a burst collapse to
  // its last click: React coalesces the three state updates into one render, and
  // only the final counter value reaches the DOM.
  const [announced, setAnnounced] = React.useState<{ at: number; index: number } | null>(null);
  /*
   * Navigation requests, for the scroll. State rather than the request counter
   * because the counter also moves on a new report, and a report arriving is not
   * the reader asking to be taken somewhere.
   */
  const [scrollRequests, setScrollRequests] = React.useState(0);

  // A new report is a new list. Keeping the old index would step into a
  // different conflict than the one the position count claims to be on.
  React.useEffect(() => {
    setPosition(0);
    requests.current += 1;
    setAnnounced(null);
    // A new list has nothing the reader asked to be scrolled to, so the first
    // card of a fresh report is reached by reading, not by being moved to.
    setScrollRequests(0);
  }, [report]);

  function step(delta: number): void {
    if (groups.length === 0) return;
    requests.current += 1;
    const next = (position + delta + groups.length) % groups.length;
    setPosition(next);
    setScrollRequests((count) => count + 1);
    setAnnounced({ at: requests.current, index: next });
  }

  return (
    <section aria-label="Consistency review result">
      <h2>Consistency review result</h2>

      {/* Coverage first, and always. */}
      <div aria-label="Consistency review coverage">
        <p role="status">
          {coverage.complete
            ? `Reviewed the whole document: ${coverage.statementsConsidered} statements, ${coverage.comparisonsMade} comparisons.`
            : // Every statement is examined; the gap is between windows. Saying
              // "X of Y statements" here would be a claim truncation is no longer
              // true of, and it would hide the much narrower real limitation.
              `Partial review: all ${coverage.statementsConsidered} statements were examined across ${coverage.windowsExamined} windows, and ${coverage.comparisonsMade} comparisons were made. ${coverage.crossWindowPairsSkipped} comparison(s) between statements in different windows were not made, so this is not a complete review of the document.`}
        </p>
        <p className="tf-sub">
          {report.usedModel
            ? `${coverage.modelAdjudicated} candidate conflict(s) were judged by a language model.`
            : "No language model was used in this run. Only directly comparable differences were found."}
        </p>
        {coverage.limitations.map((limitation) => (
          <p key={limitation} role="alert">
            {limitation}
          </p>
        ))}
        <details>
          <summary>Checks performed</summary>
          <ul>
            {Object.entries(coverage.perCheck)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([check, count]) => (
                <li key={check}>
                  {check}: {count} candidate(s)
                </li>
              ))}
          </ul>
        </details>
      </div>

      <p role="status">
        {groups.length === 1
          ? "1 possible contradiction"
          : `${groups.length} possible contradictions`}{" "}
        found.{" "}
        {collapsed > 0
          ? `${issues.length} reports collapsed into ${groups.length}, because the same pair of statements matched more than once.`
          : "Nothing has been changed in Word."}
      </p>
      {groups.length === 0 && (
        <p>
          No contradictions were found in the part of the document that was reviewed. Check the
          coverage above before treating that as a clean bill of health.
        </p>
      )}

      {/*
        Stepping, in the same vocabulary as the findings list so the two
        surfaces read as one. Wrapping rather than clamping: a finding list that
        stops at the end leaves a user who overshot with no way forward except
        eleven clicks back, and these are conflicts to read, not pages to lose
        a place in.
      */}
      {groups.length > 0 && (
        <nav className="tf-finding-actions" aria-label="Consistency issue navigation">
          <button
            className="tf-native-button"
            type="button"
            onClick={() => step(-1)}
            aria-label={`Previous contradiction, at ${position + 1} of ${groups.length}`}
          >
            Previous contradiction
          </button>
          <button
            className="tf-native-button"
            type="button"
            onClick={() => step(1)}
            aria-label={`Next contradiction, at ${position + 1} of ${groups.length}`}
          >
            Next contradiction
          </button>
          {/*
            One element, doing both jobs: showing where you are, and announcing
            that you moved. Splitting them was the wrong instinct — two elements
            each holding the count means two things to keep in step and two
            counts on screen.

            `announced` is null until the first step, and falls back to
            `position` so the count is visible on first render rather than
            appearing only once the user moves. A live region populated at
            insertion is not announced by a screen reader — only subsequent
            mutations are — so this speaks on arrival, not on mount. After a
            step the two are the same index, and on a burst only the last click's
            counter reaches the DOM, which is what collapses three announcements
            into one.
          */}
          <span className="tf-sub" aria-live="polite">
            {`Contradiction ${(announced?.index ?? position) + 1} of ${groups.length}`}
          </span>
        </nav>
      )}

      {groups.map((group, index) => (
        <ConflictCard
          key={group.key}
          group={group}
          active={index === position}
          scrollRequest={scrollRequests}
        />
      ))}

      {/*
       * There is deliberately no "Review in Findings" button here.
       *
       * It used to bridge these contradictions into the ordinary Findings list,
       * which put an inter-document judgement among the document's own style
       * deviations: same card, same Approve action, same count in the toolbar.
       * A reader had no way to tell which items a rule found and which a model
       * inferred by comparing two distant statements, and a count that mixed
       * them overstated how much of the document the deterministic rules had
       * actually checked. The two products stay on separate pages, each with its
       * own coverage statement, which is the only arrangement where the number
       * beside the list means what it says.
       */}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button className="tf-native-button" type="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </section>
  );
}
