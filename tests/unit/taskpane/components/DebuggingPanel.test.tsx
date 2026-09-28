import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DebuggingPanel, {
  diagnoseSituation,
} from "../../../../src/taskpane/components/DebuggingPanel";

const mocks = vi.hoisted(() => ({
  loadState: vi.fn(),
  isTrackedEditingEnabled: vi.fn(() => true),
  prepareReformatHost: vi.fn(),
  probeOfficeRuntime: vi.fn(() => ({}) as Record<string, unknown>),
}));

vi.mock("../../../../src/core/state/persistence", () => ({
  loadState: mocks.loadState,
}));

vi.mock("../../../../src/reformat", () => ({
  isTrackedEditingEnabled: mocks.isTrackedEditingEnabled,
  prepareReformatHost: mocks.prepareReformatHost,
}));

vi.mock("../../../../src/shared/office/diagnostics", () => ({
  probeOfficeRuntime: mocks.probeOfficeRuntime,
  formatDiagnostics: () => "diagnostics",
}));

beforeEach(() => {
  mocks.loadState.mockReturnValue({ settings: { autoScan: true } });
  mocks.isTrackedEditingEnabled.mockReturnValue(true);
});

describe("diagnoseSituation", () => {
  it("says nothing is wrong when nothing is wrong", () => {
    // The panel is a page people arrive at *because* something is wrong. A list
    // of every symptom would leave the one that matters buried.
    expect(diagnoseSituation({ autoScan: true, trackedEditing: true, coverage: null })).toEqual([]);
  });

  it("explains stale findings when auto-scan is off, and says the manual scan still works", () => {
    const notes = diagnoseSituation({ autoScan: false, trackedEditing: true, coverage: null });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe("auto-scan-off");
    expect(notes[0]?.remedy).toMatch(/re-scan now/i);
  });

  it("explains a refused Apply through tracked editing rather than the plan", () => {
    const notes = diagnoseSituation({ autoScan: true, trackedEditing: false, coverage: null });
    expect(notes[0]?.id).toBe("tracked-editing-off");
  });

  it("calls a partial analysis an unknown subset rather than a shorter list", () => {
    // The distinction matters: "fewer findings" invites the reading that the
    // rest of the document is clean, which is exactly the wrong conclusion.
    const notes = diagnoseSituation({
      autoScan: true,
      trackedEditing: true,
      coverage: { complete: false } as never,
    });
    expect(notes[0]?.id).toBe("coverage-incomplete");
    expect(notes[0]?.cause).toMatch(/unknown subset/i);
  });

  it("reports every situation that is actually true, not just the first", () => {
    // Two independent problems need two answers. Stopping at the first would
    // leave the user fixing one and still stuck.
    const notes = diagnoseSituation({
      autoScan: false,
      trackedEditing: false,
      coverage: { complete: false } as never,
    });
    expect(notes.map((note) => note.id)).toEqual([
      "auto-scan-off",
      "tracked-editing-off",
      "coverage-incomplete",
    ]);
  });
});

describe("DebuggingPanel", () => {
  it("shows the situation the user is actually in", () => {
    mocks.isTrackedEditingEnabled.mockReturnValue(false);
    render(<DebuggingPanel onBack={vi.fn()} />);

    expect(screen.getByText(/apply is refused/i)).toBeInTheDocument();
    expect(screen.queryByText(/findings stop updating/i)).not.toBeInTheDocument();
  });

  it("says plainly when nothing is standing in the way", () => {
    render(<DebuggingPanel onBack={vi.fn()} />);
    expect(screen.getByText(/nothing is currently standing between/i)).toBeInTheDocument();
  });

  it("keeps one live region even after both probes have run", async () => {
    // Probing and then diagnosing leaves both output blocks on screen. Two
    // polite regions reading in DOM order rather than run order is the defect
    // ADR-0062 fixed on the Dashboard, recurring on a second surface.
    const { container } = render(<DebuggingPanel onBack={vi.fn()} />);
    expect(container.querySelectorAll('[aria-live="polite"], [role="status"]')).toHaveLength(1);
  });
});
