import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProfile, StyleProfileSchema } from "../../../../src/core/domain/StyleProfile";

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
}));

vi.mock("../../../../src/core/state/persistence", () => ({
  loadState: () => mocks.loadState(),
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
  reviewEntireDocument: vi.fn(),
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
    version: 5,
    profiles: [] as unknown[],
    profileHistory: {},
    activeProfileId: null,
    governanceProfiles: {},
    governanceHistory: {},
    activeGovernanceProfileId: null,
    settings: {
      llmProvider: "mock" as const,
      openAiCredentialMode: "broker" as const,
      spotReviewConsent: false,
      fullDocumentReviewConsent: false,
      semanticOptIn: false,
      telemetryDisabled: true,
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

    mocks.loadState.mockReturnValue({
      ...emptyState(),
      profiles: [profile],
      activeProfileId: profile.id,
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
});
