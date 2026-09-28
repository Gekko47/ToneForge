import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ConsistencyReviewPreflight from "../../../../src/taskpane/components/ConsistencyReviewPreflight";
import ConsistencyReviewProgress from "../../../../src/taskpane/components/ConsistencyReviewProgress";
import ConsistencyReviewResults from "../../../../src/taskpane/components/ConsistencyReviewResults";
import { CONSISTENCY_DEFAULT_MAX_STATEMENTS } from "../../../../src/analysis/consistency";
import type { ConsistencyReport } from "../../../../src/analysis/consistency";

/**
 * These tests assert what the review surface is forbidden to do, mostly:
 *
 * - the preflight must say when a run will be partial, because "no problems
 *   found" over part of a document reads as "no problems found";
 * - the results must show coverage and both compared statements, and must label
 *   a low-confidence finding as advisory.
 *
 * The consent gate itself moved up into `AiReviewSection`, which now owns the
 * whole ladder; `aiReviewBlocker` is covered in `AiReviewSection.test.tsx`.
 */

function report(overrides: Partial<ConsistencyReport> = {}): ConsistencyReport {
  return {
    revision: "r1",
    issues: [],
    usedModel: true,
    startedAt: "2026-09-26T00:00:00.000Z",
    finishedAt: "2026-09-26T00:00:01.000Z",
    coverage: {
      complete: true,
      statementsConsidered: 120,
      statementsTotal: 120,
      comparisonsMade: 7140,
      crossWindowPairsSkipped: 0,
      windowsExamined: 1,
      perCheck: { C1: 1, C2: 0, C3: 1, C4: 0, C5: 0, C6: 0, C7: 0, C8: 0, C9: 0, C10: 0 },
      limitations: [],
      modelAdjudicated: 2,
    },
    ...overrides,
  };
}

describe("the consistency preflight", () => {
  it("warns that a windowed run is not a complete review", () => {
    render(
      <ConsistencyReviewPreflight
        approximateWords={9000}
        statementCount={900}
        maxStatements={CONSISTENCY_DEFAULT_MAX_STATEMENTS}
        providerName="openai"
        onStart={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const alert = screen.getByRole("alert");
    // Every statement is examined now, so the honest limitation is the pairs
    // between windows — not the statements past the bound, which the old
    // wording claimed and which is no longer true.
    expect(alert.textContent).toMatch(/3 windows/);
    expect(alert.textContent).toMatch(/different windows is not looked for/i);
    expect(alert.textContent).toMatch(/would not mean the whole document is consistent/i);
    expect(alert.textContent).not.toMatch(/will not be examined/i);
  });

  it("gives no windowing warning when the whole document fits", () => {
    render(
      <ConsistencyReviewPreflight
        approximateWords={400}
        statementCount={40}
        maxStatements={CONSISTENCY_DEFAULT_MAX_STATEMENTS}
        providerName="openai"
        onStart={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the provider the document will be sent to", () => {
    render(
      <ConsistencyReviewPreflight
        approximateWords={400}
        statementCount={40}
        maxStatements={CONSISTENCY_DEFAULT_MAX_STATEMENTS}
        providerName="openrouter"
        onStart={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByText(/openrouter/)).toBeTruthy();
  });

  it("says the review changes nothing in the document", () => {
    render(
      <ConsistencyReviewPreflight
        approximateWords={400}
        statementCount={40}
        maxStatements={CONSISTENCY_DEFAULT_MAX_STATEMENTS}
        providerName="openai"
        onStart={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByText(/nothing in your document is changed/i)).toBeTruthy();
  });
});

describe("consistency progress", () => {
  it("shows the current phase as a live status", () => {
    render(
      <ConsistencyReviewProgress
        progress={{ phase: "adjudicating", fraction: 0.7, message: "Reviewing candidate 3 of 9…" }}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/candidate 3 of 9/);
  });

  it("marks a cancelled run as partial rather than finished", () => {
    render(
      <ConsistencyReviewProgress
        progress={{ phase: "adjudicating", fraction: 0.7, message: "Reviewing…" }}
        cancelled
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/partial/i);
  });
});

describe("consistency results", () => {
  it("puts coverage before the finding count in the rendered order", () => {
    // A clean result is only meaningful next to the scope that produced it, so
    // coverage is rendered first rather than tucked away below the list.
    const { container } = render(
      <ConsistencyReviewResults
        report={report()}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    const text = container.textContent ?? "";
    expect(text.indexOf("Reviewed the whole document")).toBeGreaterThanOrEqual(0);
    /*
     * Matched without the count and the suffix, because the wording is now
     * plural-aware: "1 possible contradiction found" against "3 possible
     * contradictions found". The ordering guarantee is what is under test, not
     * the sentence.
     */
    expect(text.indexOf("Reviewed the whole document")).toBeLessThan(
      text.indexOf("possible contradiction"),
    );
  });

  it("shows the two compared statements side by side, in one labelled group", () => {
    /*
     * The split is the point: a reader who has to scroll past one statement,
     * remember it, and scroll to the other is doing the diff by hand. Both panes
     * render at once inside a single group, so the disagreement is visible.
     */
    render(
      <ConsistencyReviewResults
        report={report({
          issues: [
            {
              checkId: "C1",
              fingerprint: "C1:split",
              title: "Terminology drift",
              detail: "The same term is used two ways.",
              severity: "warning",
              confidence: 0.9,
              actionable: true,
              nodeIds: ["s0", "s1"],
              ranges: { left: { start: 0, end: 5 }, right: { start: 20, end: 30 } },
              evidence: {
                left: "Onboarding is manual.",
                right: "Onboarding is automated.",
                sectionLeft: "Intro",
                sectionRight: "Appendix",
              },
              suggestedNodeId: "s1",
            },
          ],
        })}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    const split = screen.getByRole("group", { name: /Compared statements/ });
    expect(within(split).getByText("Onboarding is manual.")).toBeTruthy();
    expect(within(split).getByText("Onboarding is automated.")).toBeTruthy();
    // The section each side came from is shown, because which of two sections is
    // the summary is often what decides whether the conflict matters.
    expect(within(split).getByText("Intro")).toBeTruthy();
    expect(within(split).getByText("Appendix")).toBeTruthy();
  });

  it("says a missing section rather than hiding it", () => {
    render(
      <ConsistencyReviewResults
        report={report({
          issues: [
            {
              checkId: "C1",
              fingerprint: "C1:no-sections",
              title: "Terminology drift",
              detail: "The same term is used two ways.",
              severity: "warning",
              confidence: 0.9,
              actionable: true,
              nodeIds: ["s0", "s1"],
              ranges: { left: { start: 0, end: 5 }, right: { start: 20, end: 30 } },
              evidence: { left: "alpha", right: "beta", sectionLeft: "", sectionRight: "" },
            },
          ],
        })}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    expect(screen.getAllByText("(no section)")).toHaveLength(2);
  });

  it("gives each conflict the shared finding actions rather than a bespoke set", () => {
    /*
     * This is the assertion that makes the two surfaces one format. Before the
     * shared body a consistency conflict had no Go to text, no Review, and no
     * Ignore: it could be read but not acted on.
     *
     * The card is a plain article, not a listbox option. It is not one of the
     * navigable findings, and claiming `option` would invent a selection model
     * for a list that has no toolbar to drive it.
     */
    render(
      <ConsistencyReviewResults
        report={report({
          issues: [
            {
              checkId: "C1",
              fingerprint: "C1:actions",
              title: "Terminology drift",
              detail: "The same term is used two ways.",
              severity: "warning",
              confidence: 0.9,
              actionable: true,
              nodeIds: ["s0", "s1"],
              ranges: { left: { start: 0, end: 5 }, right: { start: 20, end: 30 } },
              evidence: { left: "alpha", right: "beta", sectionLeft: "", sectionRight: "" },
            },
          ],
        })}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    const card = screen.getByRole("article", { name: /Consistency issue/ });
    expect(card.querySelector("[role='option']")).toBeNull();
    expect(within(card).getByRole("button", { name: "Go to text" })).toBeTruthy();
  });

  it("adds no live region of its own, keeping the one-region rule", () => {
    render(
      <ConsistencyReviewResults
        report={report({
          issues: [
            {
              checkId: "C1",
              fingerprint: "C1:live",
              title: "Terminology drift",
              detail: "The same term is used two ways.",
              severity: "warning",
              confidence: 0.9,
              actionable: true,
              nodeIds: ["s0", "s1"],
              ranges: { left: { start: 0, end: 5 }, right: { start: 20, end: 30 } },
              evidence: { left: "alpha", right: "beta", sectionLeft: "", sectionRight: "" },
            },
          ],
        })}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    // Coverage and the count. The navigation status element is always rendered
    // but is only a live region once it holds a message, so a fresh report adds
    // no new ones.
    expect(screen.getAllByRole("status").length).toBeLessThanOrEqual(2);
  });

  it("collapses repeats of one disagreement and says how many were folded in", () => {
    /*
     * The cross-section checks pair statements by shared vocabulary, so one real
     * drift arrives once per matching pair. Nine rows about one disagreement read
     * as nine problems, and a count of nine is a claim about the document that is
     * not true.
     */
    const repeated = ["a", "b", "c", "d", "e"].map((tag) => ({
      checkId: "C1" as const,
      fingerprint: `C1:${tag}`,
      title: "Terminology drift",
      detail: "The same term is used two ways.",
      severity: "warning" as const,
      confidence: 0.9,
      actionable: true,
      nodeIds: ["s0", "s1"],
      ranges: { left: { start: 0, end: 5 }, right: { start: 20, end: 30 } },
      evidence: {
        left: "Onboarding is manual.",
        right: "Onboarding is automated.",
        sectionLeft: "Intro",
        sectionRight: "Appendix",
      },
      suggestedNodeId: "s1",
    }));

    render(
      <ConsistencyReviewResults
        report={report({ issues: repeated })}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText(/5 reports collapsed into 1/)).toBeTruthy();
  });

  it("keeps different conflicts apart even under the same check", () => {
    const base = {
      checkId: "C1" as const,
      title: "Terminology drift",
      detail: "The same term is used two ways.",
      severity: "warning" as const,
      confidence: 0.9,
      actionable: true,
      nodeIds: ["s0", "s1"],
      ranges: { left: { start: 0, end: 5 }, right: { start: 20, end: 30 } },
      sectionLeft: "Intro",
      sectionRight: "Appendix",
    };

    render(
      <ConsistencyReviewResults
        report={report({
          issues: [
            {
              ...base,
              fingerprint: "one",
              evidence: { ...base, left: "alpha", right: "beta" },
            },
            {
              ...base,
              fingerprint: "two",
              evidence: { ...base, left: "alpha", right: "gamma" },
            },
          ],
        })}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("says a conflict cannot be located rather than leaving a blank location", () => {
    /*
     * No `suggestedNodeId`: the engine reported the conflict but never placed
     * either statement. An empty location line would read as a rendering fault,
     * and a reader who cannot tell the difference will go looking for text that
     * is not in the document.
     */
    render(
      <ConsistencyReviewResults
        report={report({
          issues: [
            {
              checkId: "C1",
              fingerprint: "C1:unanchored",
              title: "Terminology drift",
              detail: "The same term is used two ways.",
              severity: "warning",
              confidence: 0.8,
              actionable: true,
              nodeIds: ["s0", "s1"],
              ranges: { left: { start: 0, end: 5 }, right: { start: 20, end: 30 } },
              evidence: {
                left: "Onboarding is manual.",
                right: "Onboarding is automated.",
                sectionLeft: "",
                sectionRight: "",
              },
            },
          ],
        })}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    const location = screen.getByText(/Cannot be located in the document/);
    expect(location).toBeTruthy();
    // The located wording is the thing being contradicted, so its absence is
    // part of the assertion: printing both would leave the reader unsure.
    expect(screen.queryByText(/Located in the document\./)).toBeNull();
  });

  it("states that a located conflict is located, so the warning means something", () => {
    render(
      <ConsistencyReviewResults
        report={report({
          issues: [
            {
              checkId: "C1",
              fingerprint: "C1:anchored",
              title: "Terminology drift",
              detail: "The same term is used two ways.",
              severity: "warning",
              confidence: 0.8,
              actionable: true,
              nodeIds: ["s0", "s1"],
              ranges: { left: { start: 0, end: 5 }, right: { start: 20, end: 30 } },
              evidence: {
                left: "Onboarding is manual.",
                right: "Onboarding is automated.",
                sectionLeft: "Intro",
                sectionRight: "Appendix",
              },
              suggestedNodeId: "s1",
            },
          ],
        })}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    expect(screen.getByText(/Located in the document\./)).toBeTruthy();
    expect(screen.queryByText(/Cannot be located/)).toBeNull();
  });

  /**
   * The summary must name the real gap.
   *
   * It used to read "400 of 900 statements", which was true of a truncated run
   * and is false of a windowed one. All 900 are examined now, so the honest
   * statement is about the pairs that fell between windows.
   */
  it("says a windowed partial run is not a complete review", () => {
    render(
      <ConsistencyReviewResults
        report={report({
          coverage: {
            complete: false,
            statementsConsidered: 900,
            statementsTotal: 900,
            comparisonsMade: 239400,
            crossWindowPairsSkipped: 165000,
            windowsExamined: 3,
            perCheck: {},
            limitations: ["Compared 900 statements in windows."],
            modelAdjudicated: 3,
          },
        })}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    const summary = screen.getByText(/not a complete review/i);
    expect(summary.textContent).toMatch(/all 900 statements were examined/i);
    expect(summary.textContent).toMatch(/3 windows/);
    expect(summary.textContent).toMatch(/165000 comparison\(s\)/);
    // The old truncation phrasing must not survive in either surface.
    expect(summary.textContent).not.toMatch(/400 of 900/);
    expect(summary.textContent).not.toMatch(/first 400 of 900/);
  });

  it("refuses to let an empty result read as a clean bill of health when partial", () => {
    render(
      <ConsistencyReviewResults
        report={report({
          coverage: {
            complete: false,
            statementsConsidered: 400,
            statementsTotal: 900,
            comparisonsMade: 79800,
            crossWindowPairsSkipped: 0,
            windowsExamined: 1,
            perCheck: {},
            limitations: ["Compared the first 400 of 900 statements."],
            modelAdjudicated: 0,
          },
        })}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByText(/check the coverage above/i)).toBeTruthy();
  });

  it("states that no model was used when the run was deterministic only", () => {
    render(
      <ConsistencyReviewResults
        report={report({ usedModel: false })}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByText(/no language model was used/i)).toBeTruthy();
  });

  it("shows both statements an issue compared", () => {
    render(
      <ConsistencyReviewResults
        report={report({
          issues: [
            {
              checkId: "C2",
              fingerprint: "C2:a|b",
              title: "Numeric contradiction",
              detail: "The same quantity is given two different values.",
              severity: "error",
              confidence: 0.95,
              actionable: true,
              nodeIds: ["s0", "s1"],
              evidence: {
                left: "The quarterly revenue target is 4 million.",
                right: "The quarterly revenue target is 5 million.",
                sectionLeft: "Summary",
                sectionRight: "Detail",
              },
              suggestedText: "The quarterly revenue target is 4 million.",
              suggestedNodeId: "s0",
            },
          ],
        })}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByText(/4 million/)).toBeTruthy();
    expect(screen.getByText(/5 million/)).toBeTruthy();
    expect(screen.getByText(/Summary/)).toBeTruthy();
  });

  it("labels a low-confidence issue as advisory", () => {
    render(
      <ConsistencyReviewResults
        report={report({
          issues: [
            {
              checkId: "C4",
              fingerprint: "C4:a|b",
              title: "Entity attribute conflict",
              detail: "These two sections may disagree.",
              severity: "warning",
              confidence: 0.4,
              actionable: false,
              nodeIds: ["s0", "s1"],
              evidence: { left: "A", right: "B", sectionLeft: "", sectionRight: "" },
            },
          ],
        })}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByText(/advisory only/i)).toBeTruthy();
  });

  it("disables the findings hand-off when there is nothing to review", () => {
    render(
      <ConsistencyReviewResults
        report={report()}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: /review in findings/i })).toBeDisabled();
  });
});
