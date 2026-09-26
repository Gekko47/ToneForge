import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConsistencyReviewEntry from "../../../../src/taskpane/components/ConsistencyReviewEntry";
import ConsistencyReviewPreflight from "../../../../src/taskpane/components/ConsistencyReviewPreflight";
import ConsistencyReviewProgress from "../../../../src/taskpane/components/ConsistencyReviewProgress";
import ConsistencyReviewResults from "../../../../src/taskpane/components/ConsistencyReviewResults";
import { CONSISTENCY_DEFAULT_MAX_STATEMENTS } from "../../../../src/analysis/consistency";
import type { ConsistencyReport } from "../../../../src/analysis/consistency";

/**
 * These tests assert what the surface is forbidden to do, mostly:
 *
 * - the entry must not start a review without its own consent, and must not
 *   offer a selection or paragraph variant;
 * - the preflight must say when a run will be partial, because "no problems
 *   found" over part of a document reads as "no problems found";
 * - the results must show coverage and both compared statements, and must label
 *   a low-confidence finding as advisory.
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
      perCheck: { C1: 1, C2: 0, C3: 1, C4: 0, C5: 0, C6: 0, C7: 0, C8: 0, C9: 0, C10: 0 },
      limitations: [],
      modelAdjudicated: 2,
    },
    ...overrides,
  };
}

describe("the consistency entry", () => {
  it("starts a review when consent and a provider are both present", async () => {
    const onStart = vi.fn();
    render(
      <ConsistencyReviewEntry
        providerConfigured
        hasConsent
        onStart={onStart}
        onOpenSettings={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /consistency/i }));
    expect(onStart).toHaveBeenCalled();
  });

  it("refuses to start without its own consent, and says why", () => {
    const onStart = vi.fn();
    render(
      <ConsistencyReviewEntry
        providerConfigured
        hasConsent={false}
        onStart={onStart}
        onOpenSettings={() => undefined}
      />,
    );
    const button = screen.getByRole("button", { name: /consistency/i });
    expect(button).toBeDisabled();
    // The reason names the separation explicitly. A generic "configure first"
    // would leave a user who already granted the other two consents stuck.
    expect(screen.getByText(/its own consent/i)).toBeTruthy();
    expect(screen.getByText(/not covered by them/i)).toBeTruthy();
  });

  it("offers no selection or paragraph variant", () => {
    render(
      <ConsistencyReviewEntry
        providerConfigured
        hasConsent
        onStart={() => undefined}
        onOpenSettings={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: /selection/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /paragraph/i })).toBeNull();
  });

  it("states that the whole document is sent", () => {
    render(
      <ConsistencyReviewEntry
        providerConfigured
        hasConsent
        onStart={() => undefined}
        onOpenSettings={() => undefined}
      />,
    );
    expect(screen.getByText(/whole document at/i)).toBeTruthy();
  });

  it("warns that a model is involved and can be wrong", () => {
    render(
      <ConsistencyReviewEntry
        providerConfigured
        hasConsent
        onStart={() => undefined}
        onOpenSettings={() => undefined}
      />,
    );
    expect(screen.getByText(/can be wrong/i)).toBeTruthy();
  });
});

describe("the consistency preflight", () => {
  it("warns that a truncated run is not a complete review", () => {
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
    expect(alert.textContent).toMatch(/not be examined/i);
    expect(alert.textContent).toMatch(/would not mean the whole document is consistent/i);
  });

  it("gives no truncation warning when the whole document fits", () => {
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
    expect(text.indexOf("Reviewed the whole document")).toBeLessThan(
      text.indexOf("possible contradiction(s) found"),
    );
  });

  it("says a partial run is not a complete review", () => {
    render(
      <ConsistencyReviewResults
        report={report({
          coverage: {
            complete: false,
            statementsConsidered: 400,
            statementsTotal: 900,
            comparisonsMade: 79800,
            perCheck: {},
            limitations: ["Compared the first 400 of 900 statements."],
            modelAdjudicated: 3,
          },
        })}
        onReviewFindings={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByText(/not a complete review/i)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/first 400 of 900/);
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
