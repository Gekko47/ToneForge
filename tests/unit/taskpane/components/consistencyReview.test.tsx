import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConsistencyReviewPreflight from "../../../../src/taskpane/components/ConsistencyReviewPreflight";
import ConsistencyReviewProgress from "../../../../src/taskpane/components/ConsistencyReviewProgress";
import ConsistencyReviewResults from "../../../../src/taskpane/components/ConsistencyReviewResults";
import { CONSISTENCY_DEFAULT_MAX_PER_SUBJECT } from "../../../../src/analysis/consistency";
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
      blockOverflowSkipped: 0,
      adjudicationsUsed: 2,
      adjudicationsAvailable: 60,
      perCheck: { C1: 1, C2: 0, C3: 1, C4: 0, C5: 0, C6: 0, C7: 0, C8: 0, C9: 0, C10: 0 },
      limitations: [],
      modelAdjudicated: 2,
      quarantinedClaims: 0,
    },
    ...overrides,
  };
}

describe("the consistency preflight", () => {
  it("states the per-subject cap, because a capped run is not a complete review", () => {
    render(
      <ConsistencyReviewPreflight
        approximateWords={9000}
        statementCount={900}
        maxPerSubject={CONSISTENCY_DEFAULT_MAX_PER_SUBJECT}
        providerName="openai"
        onStart={() => undefined}
        onCancel={() => undefined}
      />,
    );
    // Every statement is indexed now, so the honest limitation is the work per
    // subject — not statements past a bound, which the old wording claimed and
    // which is no longer true.
    const text = screen.getByText(/capped at/).textContent ?? "";
    expect(text).toMatch(/900 statements/);
    expect(text).toMatch(/share a subject/);
    expect(text).toMatch(/would not mean the whole document is consistent/);
    expect(text).not.toMatch(/will not be examined/i);
  });

  it("states the same cap when the whole document fits", () => {
    render(
      <ConsistencyReviewPreflight
        approximateWords={400}
        statementCount={40}
        maxPerSubject={CONSISTENCY_DEFAULT_MAX_PER_SUBJECT}
        providerName="openai"
        onStart={() => undefined}
        onCancel={() => undefined}
      />,
    );
    // The cap is stated unconditionally: it is the bound of the run, not a
    // warning that appears only for long documents.
    expect(screen.getByText(/capped at/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the provider the document will be sent to", () => {
    render(
      <ConsistencyReviewPreflight
        approximateWords={400}
        statementCount={40}
        maxPerSubject={CONSISTENCY_DEFAULT_MAX_PER_SUBJECT}
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
        maxPerSubject={CONSISTENCY_DEFAULT_MAX_PER_SUBJECT}
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
      <ConsistencyReviewResults report={report()} onDismiss={() => undefined} />,
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
   * and is false of an indexed one. All 900 are examined now, so the honest
   * statement is about the comparisons the per-subject cap skipped.
   */
  it("says a capped partial run is not a complete review", () => {
    render(
      <ConsistencyReviewResults
        report={report({
          coverage: {
            complete: false,
            statementsConsidered: 900,
            statementsTotal: 900,
            comparisonsMade: 239400,
            blockOverflowSkipped: 165000,
            adjudicationsUsed: 3,
            adjudicationsAvailable: 60,
            perCheck: {},
            limitations: ["Compared 900 statements with a per-subject cap."],
            modelAdjudicated: 3,
            quarantinedClaims: 0,
          },
        })}
        onDismiss={() => undefined}
      />,
    );
    const summary = screen.getByText(/not a complete review/i);
    expect(summary.textContent).toMatch(/all 900 statements were examined/i);
    expect(summary.textContent).toMatch(/per-subject cap/);
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
            statementsConsidered: 900,
            statementsTotal: 900,
            comparisonsMade: 79800,
            blockOverflowSkipped: 1200,
            adjudicationsUsed: 0,
            adjudicationsAvailable: 60,
            perCheck: {},
            limitations: ["The per-subject cap skipped 1200 comparisons."],
            modelAdjudicated: 0,
            quarantinedClaims: 0,
          },
        })}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByText(/check the coverage above/i)).toBeTruthy();
  });

  it("states that no model was used when the run was deterministic only", () => {
    render(
      <ConsistencyReviewResults
        report={report({ usedModel: false })}
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
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByText(/advisory only/i)).toBeTruthy();
  });

  it("offers no hand-off into the findings list at all", () => {
    /*
     * Spec §3.3. This replaced a test asserting the hand-off button was
     * *disabled* on an empty result — which passed while the bridge existed and
     * the button was live on every non-empty one.
     *
     * The failure this is really about is a count. The Findings list and its
     * toolbar count were one number covering rule findings and model inferences
     * together, so a reader had no way to know how much of the document a rule
     * had actually checked. Removing the bridge is what makes each number mean
     * one thing, so the assertion is absence of any control at all, for a report
     * that does have contradictions in it.
     */
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
              confidence: 0.9,
              actionable: false,
              nodeIds: ["s0", "s1"],
              evidence: { left: "A", right: "B", sectionLeft: "", sectionRight: "" },
            },
          ],
        })}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: /review in findings/i })).toBeNull();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeTruthy();
  });
});

describe("stepping through the consistency results", () => {
  function conflict(tag: string) {
    return {
      checkId: "C1" as const,
      fingerprint: `C1:${tag}`,
      title: `Conflict ${tag}`,
      detail: "The same term is used two ways.",
      severity: "warning" as const,
      confidence: 0.9,
      actionable: true,
      nodeIds: [],
      evidence: {
        left: `${tag} is manual.`,
        right: `${tag} is automated.`,
        sectionLeft: "Intro",
        sectionRight: "Appendix",
      },
    };
  }

  function renderResults(tags: string[]) {
    return render(
      <ConsistencyReviewResults
        report={report({ issues: tags.map(conflict) })}
        onDismiss={() => undefined}
      />,
    );
  }

  it("offers no stepper when there is nothing to step through", () => {
    // Controls for a zero-length list are two dead buttons next to a position
    // count that can only ever read "of 0".
    renderResults([]);
    expect(screen.queryByRole("navigation", { name: /issue navigation/i })).toBeNull();
  });

  it("moves the position and speaks the destination", async () => {
    const user = userEvent.setup();
    renderResults(["one", "two", "three"]);

    /*
     * Before a step there is nothing announced yet, so the position is asserted
     * where it is actually reported: the controls' own labels. Asserting the
     * live region here would pass on the `position` fallback and read as though
     * an announcement had been made.
     */
    expect(
      screen.getByRole("button", { name: "Next contradiction, at 1 of 3" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next contradiction/i }));
    expect(screen.getByText("Contradiction 2 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /previous contradiction/i }));
    expect(screen.getByText("Contradiction 1 of 3")).toBeInTheDocument();
  });

  it("wraps rather than stopping at either end", async () => {
    /*
     * Clamping leaves a user who overshot with no way forward but to walk back
     * one at a time, and these are conflicts to read rather than pages to lose a
     * place in.
     */
    const user = userEvent.setup();
    renderResults(["one", "two"]);
    await user.click(screen.getByRole("button", { name: /previous contradiction/i }));
    expect(screen.getByText("Contradiction 2 of 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next contradiction/i }));
    expect(screen.getByText("Contradiction 1 of 2")).toBeInTheDocument();
  });

  it("reports only the last destination of a burst", async () => {
    /*
     * The S8 contract for this surface: three clicks are one gesture, so the
     * live region says where the user landed, not where they passed through.
     */
    const user = userEvent.setup();
    renderResults(["one", "two", "three", "four"]);
    const next = screen.getByRole("button", { name: /next contradiction/i });
    await user.click(next);
    await user.click(next);
    await user.click(next);

    const region = screen.getByText(/^Contradiction \d of 4$/);
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("Contradiction 4 of 4");
  });

  it("names the position in each control, not only in the status beside them", () => {
    /*
     * A screen-reader user tabbing the controls hears where they are and where
     * they will land without navigating away to the status text and back.
     */
    renderResults(["one", "two"]);
    expect(
      screen.getByRole("button", { name: "Next contradiction, at 1 of 2" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous contradiction, at 1 of 2" }),
    ).toBeInTheDocument();
  });

  it("starts again at the first contradiction when a new report replaces the old", async () => {
    /*
     * A new report is a new list. Carrying the index over would show "3 of 2"
     * or land on a contradiction the user never chose.
     */
    const user = userEvent.setup();
    const { rerender } = renderResults(["one", "two", "three"]);
    await user.click(screen.getByRole("button", { name: /next contradiction/i }));
    expect(screen.getByText("Contradiction 2 of 3")).toBeInTheDocument();

    rerender(
      <ConsistencyReviewResults
        report={report({ issues: [conflict("fresh")] })}
        onDismiss={() => undefined}
      />,
    );
    // A new report is a fresh start, so nothing is announced; the position is
    // read from the controls rather than from a live region with nothing in it.
    expect(
      screen.getByRole("button", { name: "Next contradiction, at 1 of 1" }),
    ).toBeInTheDocument();
  });
});
