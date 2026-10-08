import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DebuggingPanel from "../../../../src/taskpane/components/DebuggingPanel";

/*
 * The diagnostics themselves moved to `troubleshooting/checks.ts` and are
 * tested there. What is left here is the rendering: does the panel read the
 * current state, and does it show the remedy target rather than only prose.
 */
const mocks = vi.hoisted(() => ({
  loadState: vi.fn(),
  isTrackedEditingEnabled: vi.fn(() => true),
  prepareReformatHost: vi.fn(),
  probeOfficeRuntime: vi.fn(() => ({}) as Record<string, unknown>),
  isDecisionRoleConfigured: vi.fn(() => true),
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

vi.mock("../../../../src/taskpane/settings/providerComposition", () => ({
  isRemoteProviderConfigured: () => true,
  isDecisionRoleConfigured: mocks.isDecisionRoleConfigured,
}));

/** A state with nothing standing in the way, so only the asked-for note shows. */
function healthyState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    settings: { autoScan: true, semanticOptIn: true, decisionFallbackPolicy: "unresolved" },
    activeSemanticProfileId: "rec-1",
    providerConnections: {},
    llmRoleBindings: {},
    ...overrides,
  };
}

beforeEach(() => {
  mocks.loadState.mockReturnValue(healthyState());
  mocks.isTrackedEditingEnabled.mockReturnValue(true);
  mocks.isDecisionRoleConfigured.mockReturnValue(true);
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
    expect(screen.getByText(/nothing is currently standing in the way/i)).toBeInTheDocument();
  });

  it("names the control to change, not just the problem", () => {
    // The remedy text explains; the target tells you where to act. Without the
    // target the note is advice rather than a step.
    mocks.isTrackedEditingEnabled.mockReturnValue(false);
    render(<DebuggingPanel onBack={vi.fn()} />);

    expect(screen.getByText(/Allow ToneForge to apply tracked changes/i)).toBeInTheDocument();
  });

  it("reports an Apply blocked by an unreviewed plan, which the button alone cannot explain", () => {
    // Apply writes only reviewed findings. With a plan full of unreviewed
    // changes the button is disabled and the reason lives nowhere near it.
    render(<DebuggingPanel onBack={vi.fn()} plannedCount={4} reviewedCount={0} />);

    expect(screen.getByText(/apply is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/4 changes are waiting/i)).toBeInTheDocument();
  });

  it("does not report the review blocker when something has been reviewed", () => {
    render(<DebuggingPanel onBack={vi.fn()} plannedCount={4} reviewedCount={2} />);
    expect(screen.queryByText(/apply is unavailable/i)).not.toBeInTheDocument();
  });

  it("keeps one live region even after both probes have run", async () => {
    // Probing and then diagnosing leaves both output blocks on screen. Two
    // polite regions reading in DOM order rather than run order is the defect
    // ADR-0062 fixed on the Dashboard, recurring on a second surface.
    //
    // Both actions are actually run: the extra region this guards against only
    // appears once the second output is on screen, so counting on an untouched
    // panel proved nothing.
    mocks.prepareReformatHost.mockResolvedValue({ supportsRevisions: true });
    const { container } = render(<DebuggingPanel onBack={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /probe word capabilities/i }));
    await waitFor(() =>
      expect(container.querySelectorAll('[aria-live="polite"], [role="status"]')).toHaveLength(1),
    );
    await userEvent.click(screen.getByRole("button", { name: /diagnose office runtime/i }));
    await waitFor(() => expect(container.querySelectorAll("pre")).toHaveLength(2));

    expect(container.querySelectorAll('[aria-live="polite"], [role="status"]')).toHaveLength(1);
  });

  it("announces the diagnostic that ran last, not the first one to leave output", async () => {
    /*
     * Both output blocks persist, so deciding the announcement from "is there
     * a probe result" named the probe even after the runtime diagnosis had run.
     * The region then reported an action the user had just superseded.
     */
    mocks.prepareReformatHost.mockResolvedValue({ supportsRevisions: true });
    render(<DebuggingPanel onBack={vi.fn()} />);
    const status = screen.getByRole("status");

    await userEvent.click(screen.getByRole("button", { name: /probe word capabilities/i }));
    await waitFor(() => expect(status).toHaveTextContent(/capability probe finished/i));

    await userEvent.click(screen.getByRole("button", { name: /diagnose office runtime/i }));
    await waitFor(() => expect(status).toHaveTextContent(/office runtime diagnosis finished/i));
  });

  it("reports a withdrawn raw-text consent while the provider and profile are ready", () => {
    // Both prerequisites hold, so the only explanation on offer elsewhere is
    // one the user has already resolved.
    mocks.loadState.mockReturnValue(
      healthyState({
        settings: { autoScan: true, semanticOptIn: false, decisionFallbackPolicy: "unresolved" },
      }),
    );
    render(<DebuggingPanel onBack={vi.fn()} />);

    expect(
      screen.getByText(/sending your text to a provider is switched off/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Allow semantic analysis/i)).toBeInTheDocument();
  });

  it("reports unresolved comparisons when no decision model is bound", () => {
    mocks.isDecisionRoleConfigured.mockReturnValue(false);
    mocks.loadState.mockReturnValue(
      healthyState({
        settings: { autoScan: true, semanticOptIn: true, decisionFallbackPolicy: "unresolved" },
        llmRoleBindings: {},
      }),
    );

    render(
      <DebuggingPanel
        onBack={vi.fn()}
        consistency={{
          usedModel: true,
          complete: true,
          limitations: [],
          unresolved: 3,
          decisionParseFailed: false,
        }}
      />,
    );

    expect(screen.getByText(/left some comparisons unresolved/i)).toBeInTheDocument();
  });

  it("reports a parse failure when the decision model returns unreadable output", () => {
    render(
      <DebuggingPanel
        onBack={vi.fn()}
        consistency={{
          usedModel: true,
          complete: true,
          limitations: [],
          unresolved: 5,
          decisionParseFailed: true,
        }}
      />,
    );

    expect(screen.getByText(/answers could not be read/i)).toBeInTheDocument();
  });

  it("says nothing about the decision role when the run left nothing unresolved", () => {
    render(
      <DebuggingPanel
        onBack={vi.fn()}
        consistency={{
          usedModel: true,
          complete: true,
          limitations: [],
          unresolved: 0,
          decisionParseFailed: false,
        }}
      />,
    );

    expect(screen.queryByText(/left some comparisons unresolved/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/answers could not be read/i)).not.toBeInTheDocument();
  });
});
