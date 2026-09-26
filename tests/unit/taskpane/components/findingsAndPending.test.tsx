import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { v4 as uuidv4 } from "uuid";
import FindingsList from "../../../../src/taskpane/components/FindingsList";
import FindingsToolbar from "../../../../src/taskpane/components/FindingsToolbar";
import PendingChanges from "../../../../src/taskpane/components/PendingChanges";
import StaleBanner from "../../../../src/taskpane/components/StaleBanner";
import { createTestPlan } from "../../../fixtures/changePlans";
import { sampleFinding } from "../../../fixtures/sampleDocs";
import type { Change } from "../../../../src/core/domain/Change";

/** One applied-able change, so PendingChanges renders its table and actions. */
function planWithOneChange(): ReturnType<typeof createTestPlan> {
  return createTestPlan("hash", "base", [
    {
      id: "44444444-4444-4444-4444-444444444444",
      type: "replaceText",
      range: { start: 0, end: 5, unit: "character" },
      payload: { text: "HELLO" },
    } as unknown as Change,
  ]);
}

describe("FindingsList selection", () => {
  const findings = [1, 2, 3].map((n) =>
    sampleFinding({ id: uuidv4(), category: `category-${n}`, message: `Finding ${n}` }),
  );

  it("marks the selected card as current in a listbox", () => {
    render(<FindingsList id="list" findings={findings} selectedIndex={1} />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-current", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
  });

  it("selects nothing when the toolbar points at no finding", () => {
    render(<FindingsList id="list" findings={findings} selectedIndex={null} />);
    screen.getAllByRole("option").forEach((option) => {
      expect(option).toHaveAttribute("aria-selected", "false");
    });
  });

  it("reports the finding status so a review mark is visible, not just stored", () => {
    const reviewed = [{ ...findings[0]!, status: "reviewed" as const }];
    render(<FindingsList findings={reviewed} />);
    expect(screen.getByText(/Reviewed/)).toBeInTheDocument();
  });

  it("disables Review once a finding has been reviewed", async () => {
    const reviewed = [{ ...findings[0]!, status: "reviewed" as const }];
    render(<FindingsList findings={reviewed} onReview={() => undefined} />);
    expect(screen.getByRole("button", { name: "Reviewed" })).toBeDisabled();
  });

  it("widens the visible window so a selected finding beyond the page is rendered", () => {
    // A selection the toolbar reports but the page has not rendered is worse
    // than no pagination: the position changes and nothing on screen does.
    const many = Array.from({ length: 60 }, (_, i) =>
      sampleFinding({ id: uuidv4(), category: `c-${i}`, message: `Finding ${i}` }),
    );
    render(<FindingsList findings={many} pageSize={50} selectedIndex={55} />);
    expect(screen.getAllByRole("option")).toHaveLength(56);
    expect(screen.getAllByRole("option")[55]).toHaveAttribute("aria-selected", "true");
  });

  it("says so when there is nothing to show", () => {
    render(<FindingsList findings={[]} />);
    expect(screen.getByText("No findings detected.")).toBeInTheDocument();
  });
});

describe("FindingsToolbar", () => {
  it("points its controls at the list it navigates", () => {
    render(
      <FindingsToolbar
        label="Review findings"
        nextAction="Review or ignore"
        total={3}
        selectedIndex={1}
        listId="tf-findings-list"
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Next finding/ })).toHaveAttribute(
      "aria-controls",
      "tf-findings-list",
    );
  });

  it("names the current position in the control's accessible name", () => {
    // The position used to exist only in a live region the user had to leave the
    // buttons to hear.
    render(
      <FindingsToolbar
        label="Review findings"
        nextAction="Review or ignore"
        total={12}
        selectedIndex={3}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Next finding, at 4 of 12" })).toBeInTheDocument();
  });

  it("moves between findings", async () => {
    const onNext = vi.fn();
    render(
      <FindingsToolbar
        label="Review findings"
        nextAction="Review or ignore"
        total={3}
        selectedIndex={0}
        onPrevious={vi.fn()}
        onNext={onNext}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Next finding/ }));
    expect(onNext).toHaveBeenCalledOnce();
  });
});

describe("PendingChanges apply readiness", () => {
  const plan = planWithOneChange();

  it("disables Apply and exposes the reason rather than failing on click", async () => {
    const onApply = vi.fn();
    render(
      <PendingChanges
        plan={plan}
        findings={[]}
        onApply={onApply}
        applyDisabledReason="Tracked editing is disabled. Enable it in Settings."
      />,
    );

    const apply = screen.getByRole("button", { name: "Apply unavailable" });
    expect(apply).toBeDisabled();
    expect(apply).toHaveAccessibleDescription(
      "Tracked editing is disabled. Enable it in Settings.",
    );
    await userEvent.click(apply);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("offers the resolving action beside the reason", async () => {
    const onOpenSettings = vi.fn();
    render(
      <PendingChanges
        plan={plan}
        findings={[]}
        onApply={vi.fn()}
        applyDisabledReason="Tracked editing is disabled."
        onOpenSettings={onOpenSettings}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("offers Apply with no reason when the host is ready", async () => {
    const onApply = vi.fn().mockResolvedValue(true);
    render(<PendingChanges plan={plan} findings={[]} onApply={onApply} />);
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeEnabled();
    await userEvent.click(apply);
    expect(onApply).toHaveBeenCalledOnce();
  });

  it("gives the preview table a caption and column headers", () => {
    render(<PendingChanges plan={plan} findings={[]} onApply={vi.fn()} />);
    expect(screen.getByRole("table")).toHaveAccessibleName();
    expect(screen.getAllByRole("columnheader")).toHaveLength(5);
  });
});

describe("StaleBanner", () => {
  it("does not claim the document changed when the host is what went away", () => {
    // The observer set `stale` for an Office outage, so this banner told the
    // user to re-scan a document that had not moved.
    render(<StaleBanner stale={false} hostUnavailable lastScan={null} onRescan={vi.fn()} />);
    expect(screen.getByText("Word is unavailable")).toBeInTheDocument();
    expect(screen.getByText(/document has not changed/)).toBeInTheDocument();
    expect(screen.queryByText("Findings are stale")).not.toBeInTheDocument();
  });

  it("still reports genuine staleness with the last scan time", () => {
    render(<StaleBanner stale lastScan="2026-01-01T00:00:00.000Z" onRescan={vi.fn()} />);
    expect(screen.getByText("Findings are stale")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-scan now" })).toBeInTheDocument();
  });

  it("renders nothing when findings are current", () => {
    const { container } = render(<StaleBanner stale={false} lastScan={null} onRescan={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
