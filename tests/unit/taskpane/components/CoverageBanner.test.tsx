/**
 * The coverage verdict, as the reader receives it (spec §9, §20, §27 gate 12).
 *
 * The banner is the only place a compliance claim is stated, so these cases are
 * about the *distinction* the component has to draw rather than about the text
 * it happens to contain. Three states, three different words, and a fourth for
 * "we cannot say":
 *
 * - **Complete** — every mandatory scope was examined, over the whole document.
 * - **Incomplete** — a mandatory scope was not, so Apply is refused and the
 *   reason is named.
 * - **Unknown** — only the shared coverage report arrived. It has no
 *   requested-versus-examined list, so no claim is made either way.
 *
 * The failure the third state prevents is specific: a body-only scan with a
 * perfect acquisition reads as `complete` in `CoverageReport`, because that
 * report answers "did acquisition read everything" and the question the user
 * asks is "did the review examine everything".
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CoverageBanner from "../../../../src/taskpane/components/CoverageBanner";
import { CoverageReportSchema } from "../../../../src/core/domain/DocumentSnapshot";
import {
  DeterministicCoverageSchema,
  type DeterministicCoverage,
} from "../../../../src/analysis/deterministic/contracts";

const SHARED = CoverageReportSchema.parse({
  runId: "11111111-1111-4111-8111-111111111111",
  counts: [],
  processedCharacterCount: 0,
  revisedCharacterCount: 0,
});

function deterministic(overrides: Partial<DeterministicCoverage> = {}): DeterministicCoverage {
  return DeterministicCoverageSchema.parse({
    requestedScopes: ["body", "headings"],
    examinedScopes: ["body", "headings"],
    unsupportedScopes: [],
    excludedScopes: [],
    protectedScopes: [],
    paragraphsExamined: 12,
    headingsExamined: 3,
    listsExamined: 0,
    tablesExamined: 0,
    sectionsExamined: 0,
    headersFootersExamined: 0,
    complete: true,
    blockers: [],
    coverageFingerprint: "body,headings|p12|t0|s0|h0",
    ...overrides,
  });
}

describe("CoverageBanner", () => {
  it("says nothing at all when there is no coverage to report", () => {
    const { container } = render(
      <CoverageBanner coverage={null} open={false} onToggle={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("makes no compliance claim when only the shared report arrived", () => {
    // The honest answer, and the one the shared report alone cannot improve on.
    // Defaulting to "Complete" here is how a body-only scan would read as a
    // whole-document one.
    render(<CoverageBanner coverage={SHARED} open={false} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Coverage Unknown" })).toBeInTheDocument();
  });

  it("says the run was complete, and says what it examined", () => {
    render(
      <CoverageBanner
        coverage={SHARED}
        deterministicCoverage={deterministic()}
        open
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Coverage Complete" })).toBeInTheDocument();
    expect(screen.getByText(/12 paragraphs, 3 headings/)).toBeInTheDocument();
  });

  it("counts the structural objects it read, so a zero is a fact not a gap", () => {
    render(
      <CoverageBanner
        coverage={SHARED}
        deterministicCoverage={deterministic({
          tablesExamined: 2,
          sectionsExamined: 1,
          headersFootersExamined: 6,
        })}
        open
        onToggle={vi.fn()}
      />,
    );

    const summary = screen.getByText(/tables, 1 sections/);
    expect(summary).toHaveTextContent("2 tables");
    expect(summary).toHaveTextContent("6 headers or footers");
  });

  it("refuses compliance and names every mandatory scope that was missing", () => {
    render(
      <CoverageBanner
        coverage={SHARED}
        deterministicCoverage={deterministic({
          complete: false,
          examinedScopes: ["body"],
          requestedScopes: ["body", "headings", "tables"],
          excludedScopes: ["headings", "tables"],
          blockers: [
            {
              scope: "tables",
              reason: "tables is required but could not be read in this Word host",
              cause: "unsupportedByHost",
            },
          ],
        })}
        open
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Coverage Incomplete" })).toBeInTheDocument();
    expect(screen.getByText(/Apply is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/tables is required but could not be read/)).toBeInTheDocument();
  });

  it("states a host limitation as a limitation, not as a blocker", () => {
    /*
     * The distinction this whole file exists for. An unsupported scope with no
     * blocker behind it is something the reader should know and cannot fix by
     * pressing anything; wording it as a blocker is what trained users to
     * ignore the word "Incomplete".
     */
    render(
      <CoverageBanner
        coverage={SHARED}
        deterministicCoverage={deterministic({
          unsupportedScopes: ["tables"],
          excludedScopes: ["tables"],
        })}
        open
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Coverage Complete" })).toBeInTheDocument();
    expect(screen.getByText(/this Word host cannot read them: tables/)).toBeInTheDocument();
    expect(screen.queryByText(/Apply is unavailable/)).not.toBeInTheDocument();
  });

  it("offers the re-scan remedy only when a blocker exists", async () => {
    const onRescan = vi.fn();
    const { rerender } = render(
      <CoverageBanner
        coverage={SHARED}
        deterministicCoverage={deterministic()}
        open
        onToggle={vi.fn()}
        onRescan={onRescan}
      />,
    );
    // No blocker, so no control: §15 says a control that cannot act must say
    // why, and a button with nothing to act on has no why to give.
    expect(screen.queryByRole("button", { name: /Re-scan to check/ })).not.toBeInTheDocument();

    rerender(
      <CoverageBanner
        coverage={SHARED}
        deterministicCoverage={deterministic({
          complete: false,
          blockers: [
            {
              scope: "sections",
              reason: "sections is required but was not examined",
              cause: "excludedByPolicy",
            },
          ],
        })}
        open
        onToggle={vi.fn()}
        onRescan={onRescan}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Re-scan to check page setup/ }));
    expect(onRescan).toHaveBeenCalledWith(["sections"]);
  });

  it("omits the re-scan control when the caller cannot re-scan", () => {
    render(
      <CoverageBanner
        coverage={SHARED}
        deterministicCoverage={deterministic({
          complete: false,
          blockers: [
            {
              scope: "body",
              reason: "body is required but was not examined",
              cause: "excludedByPolicy",
            },
          ],
        })}
        open
        onToggle={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /Re-scan to check/ })).not.toBeInTheDocument();
    // The reason still stands on its own, which is the point.
    expect(screen.getByText(/body is required but was not examined/)).toBeInTheDocument();
  });

  it("collapses without hiding the verdict", () => {
    /*
     * The one thing a collapsed banner must never do is hide *whether* it
     * passed. The reasoning can collapse; the conclusion cannot, or a user who
     * never opens it cannot tell a clean document from an unchecked one.
     */
    render(
      <CoverageBanner
        coverage={SHARED}
        deterministicCoverage={deterministic({
          complete: false,
          blockers: [
            {
              scope: "body",
              reason: "body is required but was not examined",
              cause: "excludedByPolicy",
            },
          ],
        })}
        open={false}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Coverage Incomplete" })).toBeInTheDocument();
    expect(screen.queryByText(/body is required/)).not.toBeInTheDocument();
  });

  it("names excluded scopes separately from unsupported ones", () => {
    render(
      <CoverageBanner
        coverage={SHARED}
        deterministicCoverage={deterministic({
          excludedScopes: ["headersFooters"],
        })}
        open
        onToggle={vi.fn()}
      />,
    );

    // "Outside the current analysis scope" is a different sentence from "this
    // Word host cannot read them", and the two have different remedies.
    expect(
      screen.getByText(/Outside the current analysis scope: headers and footers/),
    ).toBeInTheDocument();
  });
});
