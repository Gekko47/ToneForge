/**
 * The post-apply result block (spec §19).
 *
 * The cases here are the three outcomes a user can actually be in after pressing
 * Apply, plus the two ways the report can fail to be trustworthy — reporting
 * "all good" about a document it could not re-read, and reporting a partly
 * applied plan as a success.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ApplyResultBlock from "../../../../src/taskpane/components/ApplyResultBlock";
import { DeterministicReviewReportSchema } from "../../../../src/analysis/deterministic/contracts";
import type { ApplyOutcome } from "../../../../src/reformat/orchestrator";

function outcome(overrides: Partial<ApplyOutcome> = {}): ApplyOutcome {
  return {
    changes: [],
    verifiedCount: 0,
    unverifiedCount: 0,
    failedCount: 0,
    remainingFindings: null,
    ...overrides,
  };
}

/** A refreshed report carrying `count` findings. */
function report(count: number) {
  return DeterministicReviewReportSchema.parse({
    reviewType: "deterministic",
    documentIdentity: {
      documentId: "doc-1",
      documentVersion: "v1",
      contentHash: "h",
      structuralHash: "s",
    },
    profileId: "11111111-1111-4111-8111-111111111111",
    profileRevision: 1,
    findings: Array.from({ length: count }, (_unused, index) => ({
      id: `0000000${index}-1111-4111-8111-111111111111`,
      kind: "deterministic" as const,
      category: "typography.emDash",
      range: { start: 0, end: 1, unit: "character" as const },
      message: "An em dash.",
      severity: "warning" as const,
      confidence: 1,
    })),
    groups: [],
    coverage: {
      requestedScopes: ["body"],
      examinedScopes: ["body"],
      unsupportedScopes: [],
      excludedScopes: [],
      protectedScopes: [],
      textCharactersExamined: 10,
      paragraphsExamined: 1,
      headingsExamined: 0,
      listsExamined: 0,
      tablesExamined: 0,
      sectionsExamined: 0,
      headersFootersExamined: 0,
      complete: true,
      blockers: [],
      coverageFingerprint: "body|p1|t0|s0|h0",
    },
    summary: {
      total: count,
      actionable: count,
      reportedOnly: 0,
      bySeverity: { info: 0, warning: count, error: 0 },
      byCategoryGroup: { language: count, formatting: 0, structure: 0 },
    },
  });
}

describe("ApplyResultBlock", () => {
  it("renders nothing before an apply has happened", () => {
    const { container } = render(
      <ApplyResultBlock outcome={null} open={false} onToggle={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says nothing was applied, rather than reporting a clean run", () => {
    // A preview and a plan whose every write failed both produce a zero here,
    // and they are opposite events. "0 of 0 verified" would read as success.
    render(<ApplyResultBlock outcome={outcome()} open={false} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Nothing was applied/ })).toBeInTheDocument();
  });

  it("itemises every change rather than summarising the plan", () => {
    /*
     * The whole of §19. A partly-applied plan leaves tracked revisions in the
     * document and the user has to decide per revision whether to keep it, so a
     * single sentence or a single error is not an answer they can act on.
     */
    render(
      <ApplyResultBlock
        outcome={outcome({
          changes: [
            { changeId: "change-a", verified: true, error: "" },
            {
              changeId: "change-b",
              verified: false,
              error: 'Readback expected style "Normal" but found "Body Text".',
            },
            {
              changeId: "change-c",
              verified: false,
              error: "The property is in a protected range.",
            },
          ],
          verifiedCount: 1,
          unverifiedCount: 2,
        })}
        open
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText(/1 verified, 2 written but not confirmed/)).toBeInTheDocument();
    expect(screen.getByText(/2 of 3 changes did not complete/)).toBeInTheDocument();
    expect(screen.getByText(/change-a/)).toBeInTheDocument();
    expect(screen.getByText(/Readback expected style/)).toBeInTheDocument();
    expect(screen.getByText(/protected range/)).toBeInTheDocument();
  });

  it("counts a change the adapter refused separately from one it could not confirm", () => {
    // "Written but not confirmed" and "not applied" have different remedies:
    // the first is a readback the host would not serve, the second is a refusal
    // the user may be able to act on by changing scope.
    render(
      <ApplyResultBlock
        outcome={outcome({
          changes: [
            { changeId: "a", verified: false, error: "Readback did not match." },
            { changeId: "b", verified: false, error: "The change is in a protected range." },
          ],
          verifiedCount: 0,
          unverifiedCount: 1,
          failedCount: 1,
        })}
        open
        onToggle={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/0 verified, 1 written but not confirmed, 1 not applied/),
    ).toBeInTheDocument();
  });

  it("reports a fully verified apply as a clean one", () => {
    render(
      <ApplyResultBlock
        outcome={outcome({
          changes: [
            { changeId: "a", verified: true, error: "" },
            { changeId: "b", verified: true, error: "" },
          ],
          verifiedCount: 2,
        })}
        open={false}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /2 of 2 changes verified/ })).toBeInTheDocument();
  });

  it("never says the document is clean when the refresh could not run", () => {
    /*
     * `remainingFindings: null` is "we could not look", not "there is nothing
     * left". Rendering a reassurance for it is the one thing a post-apply report
     * must not do: the apply already happened, and an unverifiable document is
     * exactly the case Track Changes leaves a user to reason about alone.
     */
    const { rerender } = render(<ApplyResultBlock outcome={outcome()} open onToggle={vi.fn()} />);
    expect(screen.queryByText(/No deviations remain/)).not.toBeInTheDocument();

    rerender(
      <ApplyResultBlock
        outcome={outcome({
          remainingFindingsError:
            "The document could not be re-read after Apply: host unavailable.",
        })}
        open
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText(/could not be re-read after Apply/)).toBeInTheDocument();
    expect(screen.queryByText(/No deviations remain/)).not.toBeInTheDocument();
  });

  it("says what is still wrong, and offers to show it", async () => {
    const onReviewRemaining = vi.fn();
    render(
      <ApplyResultBlock
        outcome={outcome({
          changes: [{ changeId: "a", verified: true, error: "" }],
          verifiedCount: 1,
          remainingFindings: report(2),
        })}
        open
        onToggle={vi.fn()}
        onReviewRemaining={onReviewRemaining}
      />,
    );

    expect(screen.getByText(/2 issues still stand after Apply/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Review the 2 remaining/ }));
    expect(onReviewRemaining).toHaveBeenCalledOnce();
  });

  it("offers no control when the refreshed review found nothing", () => {
    // A button that navigates to an empty list does nothing, and §15 says a
    // control that cannot act must say why rather than exist.
    render(
      <ApplyResultBlock
        outcome={outcome({
          changes: [{ changeId: "a", verified: true, error: "" }],
          verifiedCount: 1,
          remainingFindings: report(0),
        })}
        open
        onToggle={vi.fn()}
        onReviewRemaining={vi.fn()}
      />,
    );

    expect(screen.getByText(/No deviations remain/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Review the/ })).not.toBeInTheDocument();
  });

  it("keeps the verdict readable when the detail is collapsed", () => {
    render(
      <ApplyResultBlock
        outcome={outcome({
          changes: [{ changeId: "a", verified: false, error: "It failed." }],
          verifiedCount: 0,
          unverifiedCount: 1,
        })}
        open={false}
        onToggle={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /1 of 1 change did not complete/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("It failed.")).not.toBeInTheDocument();
  });

  it("is operable, so it matches the other collapsible sections", () => {
    const onToggle = vi.fn();
    render(
      <ApplyResultBlock
        outcome={outcome({
          changes: [{ changeId: "a", verified: true, error: "" }],
          verifiedCount: 1,
        })}
        open={false}
        onToggle={onToggle}
      />,
    );

    const header = screen.getByRole("button", { name: /Apply result/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    header.click();
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
