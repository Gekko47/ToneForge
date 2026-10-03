import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { v4 as uuidv4 } from "uuid";
import { FindingSchema, type Finding } from "../../../../src/core/domain/Finding";
import { ChangePlanSchema, type ChangePlan } from "../../../../src/core/domain/ChangePlan";
import FindingCard from "../../../../src/taskpane/components/FindingCard";
import FindingsList from "../../../../src/taskpane/components/FindingsList";
import PendingChanges from "../../../../src/taskpane/components/PendingChanges";
import CoverageBanner from "../../../../src/taskpane/components/CoverageBanner";
import StaleBanner from "../../../../src/taskpane/components/StaleBanner";
import { goToFinding } from "../../../../src/taskpane/findingNavigation";

/*
 * The shared owner, not the locator.
 *
 * Finding cards used to call `navigateToFinding` themselves, so each one owned
 * a host call and two quick clicks raced. They now go through one guard, and
 * mocking the locator here would no longer intercept anything — the card would
 * reach the real guard and the real host.
 */
vi.mock("../../../../src/taskpane/findingNavigation", () => ({
  goToFinding: vi.fn(async () => ({
    moved: true,
    message: "Selected the finding range.",
    superseded: false,
  })),
}));

function finding(overrides: Partial<Finding> = {}): Finding {
  return FindingSchema.parse({
    id: uuidv4(),
    kind: "deterministic",
    category: "typography.emDash",
    range: { start: 2, end: 5, unit: "character" },
    message: "Use an em dash.",
    severity: "warning",
    evidence: "--",
    nodeIds: [],
    source: "deterministic",
    ...overrides,
  });
}

function plan(): ChangePlan {
  const findingId = uuidv4();
  return ChangePlanSchema.parse({
    schemaVersion: 2,
    id: uuidv4(),
    docHash: "hash",
    baseDocId: "base",
    createdAt: new Date().toISOString(),
    changes: [
      {
        id: uuidv4(),
        type: "replaceText",
        range: { start: 2, end: 4 },
        payload: { text: "—" },
        rationale: "Typography rule",
        source: "deterministic",
        risk: "low",
        reversible: true,
        approvalRequired: false,
        approvalState: "notRequired",
        precondition: { kind: "text", expectedText: "--" },
        dependsOn: [],
        findingId,
      },
    ],
    conflicts: [],
  });
}

/*
 * `GovernanceDashboard` used to be tested here and has been deleted.
 *
 * It had no production importer: the review surface renders its own findings
 * list, counts and banners, so the component was reachable only from this
 * test. It also carried two of the three hardcoded colour literals in the
 * codebase. Deleting it was the fix rather than converting its colours to
 * tokens — a theme rule for a component no user can reach is a rule with
 * nothing to keep consistent.
 *
 * The test went with it. A test that renders a deleted component is the only
 * thing that kept the file alive, and keeping it would have meant keeping a
 * suite asserting behaviour that cannot occur.
 */
describe("Phase C task-pane components", () => {
  it("labels deterministic and AI findings by review context", () => {
    // UX-3 moved source and review context off the deterministic summary line
    // and into a collapsed detail region, because on that surface they are
    // constant — this is exactly the case the plan called out. The claim under
    // test is that a reader can still tell which run produced a finding, so it
    // is asserted against the detail region rather than the header.
    const { container } = render(
      <FindingsList
        findings={[
          finding(),
          finding({ id: "22222222-2222-4222-8222-222222222222", source: "ai" }),
        ]}
      />,
    );

    const regions = container.querySelectorAll(".tf-finding-detail-region");
    expect(regions).toHaveLength(2);
    expect(regions[0]?.textContent).toContain("Document scan");
    expect(regions[1]?.textContent).toContain("Current AI review");
  });

  it("exposes navigation, approve, skip and ignore as separate actions", async () => {
    // Spec §15: Approve, Skip and Ignore are three different decisions about
    // three different things, and the card offers each one. A card that merged
    // them into "Review" told the user nothing about what pressing it did.
    const item = finding();
    const onReview = vi.fn();
    const onIgnore = vi.fn();
    const onSkip = vi.fn();
    render(
      <FindingCard
        finding={item}
        onReview={onReview}
        onIgnore={onIgnore}
        onSkip={onSkip}
        onUndo={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Go to text" }));
    expect(goToFinding).toHaveBeenCalledWith(item);
    expect(await screen.findByText("Selected the finding range.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    expect(onReview).toHaveBeenCalledWith(item);
    expect(onSkip).toHaveBeenCalledWith(item);
    expect(onIgnore).toHaveBeenCalledWith(item.id);
    // No card-level write control. Apply lives in Pending Changes and is the
    // only thing that mutates the document.
    expect(screen.queryByRole("button", { name: /Apply/ })).not.toBeInTheDocument();
  });

  it("states that manual correction is required, and omits Approve, when no correction exists", () => {
    // Spec §14.7. A finding the planner cannot correct still needs a decision, so
    // Skip is offered.
    //
    // UX-1 changed the *mechanism*, not the claim. Approve used to render here
    // disabled with the reason beside it, which left the reader unable to tell
    // "ToneForge will fix this" from "you must fix this yourself" — both cards
    // had the same action row, one of them merely greyed out. Approve is now
    // omitted outright, the reason is stated in words, and Go to text stays
    // because navigation is exactly what a manual correction needs.
    const item = finding({
      deterministic: {
        profilePath: "formatting.bodyStyle.alignment",
        correctionAvailable: false,
        correctionReason: "A property override is corrected by applying the configured Word style.",
      },
    });
    const { container } = render(
      <FindingCard
        finding={item}
        onReview={vi.fn()}
        onSkip={vi.fn()}
        onUndo={vi.fn()}
        approveRefusal={"A property override is corrected by applying the configured Word style."}
      />,
    );
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByRole("button", { name: "Skip" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Go to text" })).toBeEnabled();
    // Read the region rather than matching across the <strong>/text split: the
    // heading and the reason are separate nodes, so a whole-element text matcher
    // sees only one of them.
    const manual = container.querySelector(".tf-finding-manual");
    expect(manual?.textContent).toContain("Manual correction required.");
    expect(manual?.textContent).toContain(
      "A property override is corrected by applying the configured Word style.",
    );
  });

  it("leaves the working state and reports a failure when navigation rejects", async () => {
    const item = finding();
    vi.mocked(goToFinding).mockRejectedValueOnce(new Error("host unavailable"));
    render(<FindingCard finding={item} />);

    fireEvent.click(screen.getByRole("button", { name: "Go to text" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      `Finding ${item.id} could not be selected: host unavailable`,
    );
    expect(screen.getByRole("button", { name: "Go to text" })).toBeEnabled();
  });

  it("gives each card its own navigation status id", () => {
    const first = finding();
    const second = finding();
    render(
      <div>
        <FindingCard finding={first} />
        <FindingCard finding={second} />
      </div>,
    );

    const buttons = screen.getAllByRole("button", { name: "Go to text" });
    const ids = buttons.map((button) => button.getAttribute("aria-describedby"));
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual([
      `finding-navigation-status-${first.id}`,
      `finding-navigation-status-${second.id}`,
    ]);
  });

  it("renders an empty findings state", () => {
    render(<FindingsList findings={[]} />);
    expect(screen.getByText("No findings detected.")).toBeInTheDocument();
  });

  it("renders before and after values and invokes a real rejection callback", () => {
    const linkedFinding = finding({ actual: "--", expected: "—" });
    const pending = plan();
    const onReject = vi.fn();
    const linkedPlan = {
      ...pending,
      changes: pending.changes.map((change) => ({ ...change, findingId: linkedFinding.id })),
    };
    render(
      <PendingChanges
        plan={linkedPlan}
        findings={[linkedFinding]}
        onApply={vi.fn()}
        onReject={onReject}
      />,
    );

    // Before and after are separate labelled rows on the card (spec §17), not a
    // single "Before: x" string, so the reader can see which is which without
    // parsing the value.
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
    expect(screen.getByText("--")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    // The buttons name their scope. "Apply" beside a table of one said nothing
    // about what it would write, and "Reject" read as refusing one change rather
    // than the whole list beside it.
    expect(screen.getByRole("button", { name: "Apply 1 with Track Changes" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    expect(onReject).toHaveBeenCalledOnce();
    expect(screen.getByText("Changes rejected.")).toBeInTheDocument();
  });

  it("disables apply with a truthful reason when a plan is blocked", () => {
    const pending = plan();
    render(
      <PendingChanges
        plan={{ ...pending, stale: true }}
        findings={[]}
        applyDisabledReason="Preview again because the document changed."
        onApply={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Apply unavailable" });
    expect(button).toBeDisabled();
    const localReason = screen.getByText("This plan is stale; preview it again.");
    expect(localReason).toHaveAttribute("id");
    expect(button).toHaveAttribute("aria-describedby", `${localReason.id} pending-apply-readiness`);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Preview again because the document changed.",
    );
  });

  it("blocks apply locally for stale and conflicting plans even without a host reason", () => {
    const pending = plan();
    const { rerender } = render(
      <PendingChanges plan={{ ...pending, stale: true }} findings={[]} onApply={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Apply unavailable" })).toBeDisabled();
    expect(screen.getByText("This plan is stale; preview it again.")).toBeInTheDocument();

    rerender(
      <PendingChanges
        plan={{ ...pending, conflicts: ["Overlapping changes"] }}
        findings={[]}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Apply unavailable" })).toBeDisabled();
    expect(
      screen.getByText("Unresolved conflicts block application; preview it again."),
    ).toBeInTheDocument();
  });

  it("announces incomplete coverage without claiming a complete review", () => {
    const pending = plan();
    render(
      <PendingChanges
        plan={pending}
        findings={[]}
        coverage={{
          complete: false,
          unsupported: ["tables"],
          unprocessed: ["Analysis window is partial"],
        }}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Coverage is incomplete");
    expect(screen.getByRole("status")).toHaveTextContent("tables");
  });

  it("renders coverage, stale, and unavailable states with text status", () => {
    const { rerender } = render(
      <CoverageBanner
        // Opened explicitly: the banner now collapses like Findings and
        // Pending changes, so a collapsed render would not show the reasons at
        // all. The verdict stays in the header either way — asserted below.
        open
        onToggle={vi.fn()}
        coverage={{
          runId: uuidv4(),
          counts: [],
          processedCharacterCount: 0,
          revisedCharacterCount: 0,
          examinedNodeIds: [],
          excluded: [],
          unsupported: [],
          unprocessed: ["Required node inaccessible"],
          plannedChangeCount: 0,
          appliedChangeCount: 0,
          changedNodeIds: [],
          complete: false,
          protectedOnly: false,
        }}
        /*
         * The verdict needs the deterministic projection as well as the shared
         * report. `CoverageReport.complete` answers "did acquisition read
         * everything", which is a different question from "did the review
         * examine everything", and the banner says "Unknown" rather than pick
         * one — see `CoverageBanner.test.tsx`.
         */
        deterministicCoverage={{
          requestedScopes: ["body"],
          examinedScopes: [],
          unsupportedScopes: [],
          excludedScopes: ["body"],
          protectedScopes: [],
          textCharactersExamined: 0,
          paragraphsExamined: 0,
          headingsExamined: 0,
          listsExamined: 0,
          tablesExamined: 0,
          sectionsExamined: 0,
          headersFootersExamined: 0,
          complete: false,
          blockers: [
            {
              scope: "body",
              reason: "body is required but was not examined",
              cause: "excludedByPolicy",
            },
          ],
          coverageFingerprint: "body|p0|t0|s0|h0",
        }}
      />,
    );
    expect(screen.getByText(/Incomplete/)).toBeInTheDocument();
    expect(screen.getByText("Required node inaccessible")).toBeInTheDocument();

    rerender(<StaleBanner stale onRescan={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Findings are stale" })).toBeInTheDocument();
  });
});
