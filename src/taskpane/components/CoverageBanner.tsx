/**
 * CoverageBanner — what this review did and did not examine.
 *
 * Spec §9, §20 and §27 gate 12. The banner is the only place a compliance claim
 * is stated, so it has to distinguish two things the old version collapsed into
 * one "Incomplete" label:
 *
 * - a **limitation** — a scope the host could not read, or one the policy
 *   excluded. Real, worth stating, and not a reason to refuse Apply.
 * - a **blocker** — a scope the author marked mandatory that was not examined.
 *   Apply is refused, and the reason is named.
 *
 * The distinction is not cosmetic. When every host gap produced "Incomplete", the
 * only thing a user could learn from the word was to ignore it, and a genuine
 * partial scan then read as a clean document — the false-compliance claim the
 * whole coverage model exists to prevent.
 *
 * Collapsible, like Findings and Pending changes, because the verdict is
 * reference information most of the time and the reasoning is what makes a page
 * unreadable. The verdict itself stays in the collapsed header, so collapsing
 * hides the reasoning and never the conclusion.
 */

import React from "react";
import type { CoverageReport } from "../../core/domain/DocumentSnapshot";
import type {
  CoverageBlocker,
  DeterministicCoverage,
  ScopeKind,
} from "../../analysis/deterministic/contracts";
import { coverageVerdict, verdictDetail, verdictLabel } from "../coverageVerdict";

export interface CoverageBannerProps {
  /** The shared report: per-node counts and acquisition diagnostics. */
  coverage: CoverageReport | null;
  /**
   * The deterministic projection.
   *
   * Optional, and the banner says so rather than guessing. A caller that has
   * only the shared report cannot state a compliance claim at all, because
   * `CoverageReport` has no requested-versus-examined distinction — so the
   * banner shows the counts and no verdict instead of inferring one.
   */
  deterministicCoverage?: DeterministicCoverage | null;
  /**
   * Findings the user has not decided, for the compliance verdict.
   *
   * Passed in rather than derived here: the banner is the only surface allowed to
   * state a compliance claim, and a claim needs the findings as well as the
   * coverage. `DeterministicCoverage` knows what was examined and nothing about
   * whether anything was wrong, so a verdict derived from it alone would report a
   * document with two hundred open findings as `Complete`.
   */
  openFindings?: number;
  /** Whether the detail is expanded. */
  open: boolean;
  onToggle: () => void;
  /**
   * Re-runs the scan, so a scope the host could not read gets another attempt.
   *
   * **A re-scan, not a filter.** The plan calls this action "Review in findings",
   * and the name describes an intention rather than a mechanism: a mandatory
   * scope that was not examined has, by definition, no findings behind it — the
   * scope was not looked at — so there is nothing in the list to filter to. A
   * button that navigated to an empty list would leave the reader with a control
   * that did nothing and a blocker still in place.
   *
   * What *can* be done about a blocker is try again, and the reason it might
   * work the second time is a capability set that changed: a fresh probe, a
   * different requirement set, or a scope the policy has since included. So the
   * action re-scans and says what it is doing, and the blocker list stays on
   * screen until the new scan replaces it.
   */
  onRescan?: (scopes: readonly ScopeKind[]) => void;
}

/** The user's word for a scope, rather than the internal key. */
const SCOPE_LABEL: Readonly<Record<ScopeKind, string>> = {
  body: "body text",
  headings: "headings",
  lists: "lists",
  tables: "tables",
  sections: "page setup",
  headersFooters: "headers and footers",
  textBoxes: "text boxes",
  fields: "fields",
  contentControls: "content controls",
  shapes: "shapes",
};

/**
 * The reader's word for a scope.
 *
 * Exported so every surface that names a scope says it the same way. The banner's
 * own "Re-scan to check ..." and the note beside it are the same fact about the
 * same run, and one of them spelling `headersFooters` while the other spelled
 * "headers and footers" is a defect the reader cannot resolve.
 */
export function scopeLabel(scope: ScopeKind): string {
  return SCOPE_LABEL[scope];
}

function listScopes(scopes: readonly ScopeKind[]): string {
  return scopes.map(scopeLabel).join(", ");
}

/** What a blocker is asking for, in the reader's terms. */
function blockerLine(blocker: CoverageBlocker): string {
  return blocker.reason;
}

export default function CoverageBanner({
  coverage,
  deterministicCoverage = null,
  openFindings = 0,
  open,
  onToggle,
  onRescan,
}: CoverageBannerProps): React.ReactNode {
  if (!coverage && !deterministicCoverage) {
    return null;
  }

  /*
   * Four verdicts, derived in one pure module (`taskpane/coverageVerdict`).
   *
   * `unknown` is the honest answer when only the shared report arrived: it
   * carries no requested-versus-examined list, so no compliance claim is available
   * at all. `compliant` requires complete coverage *and* nothing open — the old
   * three-verdict form said "Complete" for a run that found two hundred problems.
   */
  const verdictInput = { coverage: deterministicCoverage, openFindings };
  const verdict = coverageVerdict(verdictInput);
  const incomplete = verdict === "incomplete";
  const blockers = deterministicCoverage?.blockers ?? [];
  /*
   * A scope the host cannot read is already named above, with the only remedy
   * that helps. Naming it again here would tell the reader the same scope is
   * both "outside the analysis scope" and "a different Word version will fix
   * it", and the two sentences send them to opposite places.
   */
  const namedExcludedScopes =
    deterministicCoverage?.excludedScopes?.filter(
      (scope) => !(deterministicCoverage.unsupportedScopes ?? []).includes(scope),
    ) ?? [];
  const blockedScopes = [...new Set(blockers.map((blocker) => blocker.scope))];
  const canRescan = onRescan !== undefined && blockedScopes.length > 0;

  return (
    <section className="tf-collapsible" aria-label="Coverage section">
      {/*
        A real button rather than a heading: Findings and Pending changes are
        both operable, and three siblings where one is not is the inconsistency
        the user noticed.
      */}
      <button
        type="button"
        className="tf-native-button tf-collapsible-header"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`Coverage ${verdictLabel(verdict)}`}
      >
        Coverage <span>{verdictLabel(verdict)}</span>
      </button>
      {/*
        The panel keeps its own border and background so the verdict is
        visible at a glance even when the detail is collapsed. The border
        carries the verdict through the theme's own tokens; the panel uses the
        theme's surface so it can never disagree with the page it sits on.
      */}
      {open && (
        <div className={incomplete ? "tf-coverage tf-coverage-incomplete" : "tf-coverage"}>
          {/*
            The blocker list comes first, and it is the only thing here that
            stops Apply. A reader who fixes nothing else will read it; a reader
            who skips to the bottom will not, which is why it is not last.
          */}
          {blockers.length > 0 && (
            <>
              <p className="tf-coverage-blocked" role="status">
                {blockers.length === 1
                  ? "One required scope was not checked, so Apply is unavailable."
                  : `${blockers.length} required scopes were not checked, so Apply is unavailable.`}
              </p>
              <ul className="tf-coverage-reasons">
                {blockers.map((blocker) => (
                  <li key={`${blocker.scope}-${blocker.cause}`} className="tf-coverage-reason">
                    {blockerLine(blocker)}
                  </li>
                ))}
              </ul>
              {canRescan && (
                <button
                  type="button"
                  className="tf-native-button tf-coverage-action"
                  onClick={() => onRescan?.(blockedScopes)}
                >
                  Re-scan to check {listScopes(blockedScopes)}
                </button>
              )}
            </>
          )}

          {deterministicCoverage !== null && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
              Examined {deterministicCoverage.paragraphsExamined.toLocaleString()} paragraphs,{" "}
              {deterministicCoverage.headingsExamined.toLocaleString()} headings,{" "}
              {deterministicCoverage.listsExamined.toLocaleString()} list items,{" "}
              {deterministicCoverage.tablesExamined.toLocaleString()} tables,{" "}
              {deterministicCoverage.sectionsExamined.toLocaleString()} sections and{" "}
              {deterministicCoverage.headersFootersExamined.toLocaleString()} headers or footers.
            </p>
          )}

          {coverage !== null && coverage.revisedCharacterCount > 0 && (
            <p style={{ margin: 0, fontSize: "0.85rem" }}>
              {coverage.revisedCharacterCount.toLocaleString()} characters changed in the current
              workflow.
            </p>
          )}

          {/*
            A limitation, not a blocker, and worded so the reader knows which it
            is. "Unsupported" alone is a category name; the sentence says what to
            do about it, which is the difference between information and an
            obstacle.
          */}
          {deterministicCoverage !== null &&
            (deterministicCoverage.unsupportedScopes ?? []).length > 0 && (
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
                Not checked because this Word host cannot read them:{" "}
                {listScopes(deterministicCoverage.unsupportedScopes)}. A different Word version, or
                turning the scope off in the governance policy, will change this.
              </p>
            )}

          {namedExcludedScopes.length > 0 && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
              Outside the current analysis scope: {listScopes(namedExcludedScopes)}.
            </p>
          )}

          {coverage !== null && coverage.unsupported.length > 0 && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
              Properties this host would not serve: {coverage.unsupported.join(", ")}
            </p>
          )}

          {coverage !== null && coverage.unprocessed.length > 0 && (
            <ul style={{ margin: "0.5rem 0 0 0", fontSize: "0.85rem" }}>
              {coverage.unprocessed.map((reason, index) => (
                <li key={index} className="tf-coverage-reason">
                  {reason}
                </li>
              ))}
            </ul>
          )}

          {coverage !== null && coverage.excluded.length > 0 && (
            <p style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
              {coverage.excluded.length} protected or excluded area(s) were not checked.
            </p>
          )}

          {/*
            What the verdict does and does not cover, from the one module that
            owns it. The previous sentence here was a hand-written "Unknown"
            explanation, so the four verdicts each carried their own wording and
            only three of them had one at all.
          */}
          <p className="tf-sub">{verdictDetail(verdict, verdictInput)}</p>
          <p className="tf-sub">Technical coverage details are available in Troubleshooting.</p>
        </div>
      )}
    </section>
  );
}
