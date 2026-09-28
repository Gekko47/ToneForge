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
import { navigateToFinding } from "../../../../src/word/sourceLocator";

vi.mock("../../../../src/word/sourceLocator", () => ({
  navigateToFinding: vi.fn(async () => ({
    navigated: true,
    method: "offsets" as const,
    message: "Selected the finding range.",
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
    render(
      <FindingsList
        findings={[
          finding(),
          finding({ id: "22222222-2222-4222-8222-222222222222", source: "ai" }),
        ]}
      />,
    );

    expect(screen.getByText(/Document scan/)).toBeInTheDocument();
    expect(screen.getByText(/Current AI review/)).toBeInTheDocument();
  });

  it("exposes finding navigation, review, and ignore actions", async () => {
    const item = finding();
    const onReview = vi.fn();
    const onIgnore = vi.fn();
    render(<FindingCard finding={item} onReview={onReview} onIgnore={onIgnore} />);

    fireEvent.click(screen.getByRole("button", { name: "Go to text" }));
    expect(navigateToFinding).toHaveBeenCalledWith({ finding: item });
    expect(await screen.findByText("Selected the finding range.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    expect(onReview).toHaveBeenCalledWith(item);
    expect(onIgnore).toHaveBeenCalledWith(item.id);
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
  });

  it("leaves the working state and reports a failure when navigation rejects", async () => {
    const item = finding();
    vi.mocked(navigateToFinding).mockRejectedValueOnce(new Error("host unavailable"));
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

    expect(screen.getByText("Before: --")).toBeInTheDocument();
    expect(screen.getByText("After: —")).toBeInTheDocument();
    // The buttons name their scope. "Apply" beside a table of one said nothing
    // about what it would write, and "Reject" read as refusing one change rather
    // than the whole list beside it.
    expect(screen.getByRole("button", { name: "Apply 1 reviewed change" })).toBeEnabled();
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
      />,
    );
    expect(screen.getByText(/Incomplete/)).toBeInTheDocument();
    expect(screen.getByText("Required node inaccessible")).toBeInTheDocument();

    rerender(<StaleBanner stale lastScan={null} onRescan={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Findings are stale" })).toBeInTheDocument();
  });
});
