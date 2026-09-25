import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { v4 as uuidv4 } from "uuid";
import { FindingSchema, type Finding } from "../../../../src/core/domain/Finding";
import { ChangePlanSchema, type ChangePlan } from "../../../../src/core/domain/ChangePlan";
import GovernanceDashboard from "../../../../src/taskpane/components/GovernanceDashboard";
import FindingCard from "../../../../src/taskpane/components/FindingCard";
import FindingsList from "../../../../src/taskpane/components/FindingsList";
import PendingChanges from "../../../../src/taskpane/components/PendingChanges";
import CoverageBanner from "../../../../src/taskpane/components/CoverageBanner";
import StaleBanner from "../../../../src/taskpane/components/StaleBanner";
import AiUnavailable from "../../../../src/taskpane/components/AiUnavailable";
import AiReviewEntry from "../../../../src/taskpane/components/AiReviewEntry";
import { navigateToFinding } from "../../../../src/word/sourceLocator";

vi.mock("../../../../src/word/sourceLocator", () => ({
  navigateToFinding: vi.fn(async () => ({
    navigated: true,
    method: "offsets",
    message: "selected",
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

describe("Phase C task-pane components", () => {
  it("shows mandatory and advisory governance counts without a compliance score", () => {
    render(
      <GovernanceDashboard
        findings={[finding({ severity: "error" }), finding({ category: "houseStyle.bannedTerm" })]}
        lastScan="2026-01-01T00:00:00.000Z"
        stale={false}
        onViewFindings={vi.fn()}
        onRescan={vi.fn()}
      />,
    );

    expect(screen.getByText("Mandatory")).toBeInTheDocument();
    expect(screen.getByText("Advisory")).toBeInTheDocument();
    expect(screen.queryByText(/compliance score/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View findings" })).toBeInTheDocument();
  });

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

  it("exposes finding navigation and actions", () => {
    const item = finding();
    const onApply = vi.fn();
    const onIgnore = vi.fn();
    render(<FindingCard finding={item} onApply={onApply} onIgnore={onIgnore} />);

    fireEvent.click(screen.getByRole("button", { name: "Go to text" }));
    expect(navigateToFinding).toHaveBeenCalledWith({ finding: item });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    expect(onApply).toHaveBeenCalledWith(item);
    expect(onIgnore).toHaveBeenCalledWith(item.id);
  });

  it("renders an empty findings state", () => {
    render(<FindingsList findings={[]} />);
    expect(screen.getByText("No findings detected.")).toBeInTheDocument();
  });

  it("renders before and after values and disabled reasons in pending changes", () => {
    const linkedFinding = finding({ actual: "--", expected: "—" });
    const pending = plan();
    const linkedPlan = {
      ...pending,
      changes: pending.changes.map((change) => ({ ...change, findingId: linkedFinding.id })),
    };
    render(
      <PendingChanges
        plan={linkedPlan}
        findings={[linkedFinding]}
        onApply={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("Before: --")).toBeInTheDocument();
    expect(screen.getByText("After: —")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
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

    expect(screen.getByRole("button", { name: "Apply unavailable" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Preview again because the document changed.",
    );
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
        }}
      />,
    );
    expect(screen.getByText(/Incomplete/)).toBeInTheDocument();
    expect(screen.getByText("Required node inaccessible")).toBeInTheDocument();

    rerender(<StaleBanner stale lastScan={null} onRescan={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Findings are stale" })).toBeInTheDocument();

    rerender(<AiUnavailable action="Review selection" />);
    expect(screen.getByText(/deterministic checks remain available/i)).toBeInTheDocument();
  });

  it("disables AI entry points until provider, consent, and capability are present", () => {
    render(
      <AiReviewEntry
        supportsSelection={false}
        supportsParagraphResolution={false}
        hasSelection={false}
        providerConfigured={false}
        hasConsent={false}
        hasFullDocumentConsent={false}
        onReviewSelection={vi.fn()}
        onReviewParagraph={vi.fn()}
        onReviewDocument={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Review selection" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review paragraph" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review entire document" })).toBeDisabled();
  });
});
