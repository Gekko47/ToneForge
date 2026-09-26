import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProfile, StyleProfileSchema } from "../../../../src/core/domain/StyleProfile";
import { createRecord } from "../../../../src/core/domain/ProfileRecord";
import { sampleFinding } from "../../../fixtures/sampleDocs";

const mocks = vi.hoisted(() => ({
  loadState: vi.fn(),
  reload: vi.fn(),
  createDocumentObserver: vi.fn((_options: unknown) => ({
    startObserver: vi.fn(),
    stopObserver: vi.fn(),
    onDocumentChanged: vi.fn(),
  })),
  startParagraphEvents: vi.fn(async () => undefined),
  prepareReformatHost: vi.fn(async () => null),
  isTrackedEditingEnabled: vi.fn(() => true),
}));

vi.mock("../../../../src/core/state/persistence", () => ({
  loadState: () => mocks.loadState(),
  saveState: vi.fn(),
}));

vi.mock("../../../../src/core/state", () => ({
  loadState: () => mocks.loadState(),
  saveState: vi.fn(),
}));

vi.mock("../../../../src/word/documentObserver", () => ({
  createDocumentObserver: (options: unknown) => {
    mocks.createDocumentObserver(options);
    return {
      startObserver: vi.fn(),
      stopObserver: vi.fn(),
      onDocumentChanged: vi.fn(),
    };
  },
}));

vi.mock("../../../../src/word/wordParagraphEvents", () => ({
  createWordParagraphEventAdapter: () => ({
    start: mocks.startParagraphEvents,
    stop: vi.fn(),
  }),
}));

vi.mock("../../../../src/reformat", () => ({
  prepareReformatHost: mocks.prepareReformatHost,
  applyReviewedPlan: vi.fn(),
  isTrackedEditingEnabled: mocks.isTrackedEditingEnabled,
}));

// The first-run editor only needs to report that the user navigated back; the
// profile itself is persisted by the editor, not by this page.
vi.mock("../../../../src/taskpane/pages/Profile", () => ({
  default: function ProfileSetup({ onBack }: { onBack: () => void }): React.ReactNode {
    return (
      <button type="button" onClick={onBack}>
        Leave profile setup
      </button>
    );
  },
}));

import Dashboard from "../../../../src/taskpane/pages/Dashboard";

function emptyState() {
  return {
    version: 7,
    profileRecords: {} as Record<string, unknown>,
    activeProfileId: null,
    governanceProfiles: {},
    governanceHistory: {},
    activeGovernanceProfileId: null,
    settings: {
      llmProvider: "mock" as const,
      openAiCredentialMode: "broker" as const,
      semanticOptIn: false,
    },
  };
}

describe("Dashboard profile resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    // A reload would silently satisfy the old behaviour, so make it observable.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: mocks.reload },
    });
  });

  it("adopts a profile created in setup without reloading the task pane", async () => {
    const user = userEvent.setup();
    const profile = StyleProfileSchema.parse(createEmptyProfile("Learned style profile"));
    mocks.loadState.mockReturnValue(emptyState());

    render(<Dashboard />);
    expect(screen.getByRole("heading", { name: "Create a style profile" })).toBeInTheDocument();

    const record = createRecord(profile.id, profile.name, profile.createdAt, profile);
    mocks.loadState.mockReturnValue({
      ...emptyState(),
      profileRecords: { [record.id]: record },
      activeProfileId: record.id,
    });
    await user.click(await screen.findByRole("button", { name: "Leave profile setup" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Create a style profile" }),
      ).not.toBeInTheDocument(),
    );
    expect(mocks.reload).not.toHaveBeenCalled();
    // Office-dependent wiring is established by the dashboard, not by a reload.
    expect(mocks.prepareReformatHost).toHaveBeenCalled();
    expect(mocks.createDocumentObserver).toHaveBeenCalled();
  });

  it("stays in setup when leaving the editor without a profile", async () => {
    const user = userEvent.setup();
    mocks.loadState.mockReturnValue(emptyState());

    render(<Dashboard />);
    await user.click(await screen.findByRole("button", { name: "Leave profile setup" }));

    expect(screen.getByRole("heading", { name: "Create a style profile" })).toBeInTheDocument();
    expect(mocks.reload).not.toHaveBeenCalled();
  });

  /**
   * One live region, and it is the only one.
   *
   * The observer, the apply path, and the host banner each used to render their
   * own `role="status"` element, so two of them could speak in the same tick and
   * a screen reader read them in DOM order rather than in the order they
   * happened. The priority that decides which one wins now lives in
   * `deriveAnnouncement`; this asserts the structural half — that the surfaces
   * are visible text and the region is singular.
   */
  it("announces a settled scan through a single live region", async () => {
    // The observer only exists once a profile does, so this needs a real record
    // rather than the empty state the surrounding cases use.
    const profile = StyleProfileSchema.parse(createEmptyProfile("Announced"));
    const record = createRecord(profile.id, profile.name, profile.createdAt, profile);
    mocks.loadState.mockReturnValue({
      ...emptyState(),
      profileRecords: { [record.id]: record },
      activeProfileId: record.id,
    });

    render(<Dashboard />);
    await waitFor(() => expect(mocks.createDocumentObserver).toHaveBeenCalled());

    const options = mocks.createDocumentObserver.mock.calls[0]?.[0] as {
      onStatus: (status: unknown) => void;
    };
    act(() => {
      options.onStatus({
        phase: "fresh",
        findings: [sampleFinding()],
        coverage: null,
        stale: false,
        hostUnavailable: false,
        lastScan: new Date().toISOString(),
        error: null,
      });
    });

    // Re-queried each time: the announcement settles on a timer, so a snapshot
    // taken before the delay would read the region as empty and pass vacuously.
    // The observer's own `role="status"` used to be one of these.
    await waitFor(
      () =>
        expect(
          screen
            .getAllByRole("status")
            .some((node) => /Scan complete/.test(node.textContent ?? "")),
        ).toBe(true),
      { timeout: 3000 },
    );
    expect(
      screen.getAllByRole("status").filter((node) => node.getAttribute("aria-live") === "polite"),
    ).toHaveLength(1);
  });
});
