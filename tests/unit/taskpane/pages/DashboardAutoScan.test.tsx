import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProfile, StyleProfileSchema } from "../../../../src/core/domain/StyleProfile";
import { createRecord } from "../../../../src/core/domain/ProfileRecord";
import { sampleFinding } from "../../../fixtures/sampleDocs";

/**
 * `settings.autoScan` was persisted and defaulted but read nowhere.
 *
 * The observer started unconditionally, so a user who turned auto-scan off got
 * exactly the same behaviour as one who left it on. The setting was a stored
 * intention with no effect — the same class of defect as the ignore list being
 * written and then discarded, and the reason these tests drive the real Dashboard
 * rather than asserting on a helper that only exists to be asserted on.
 */

const mocks = vi.hoisted(() => ({
  loadState: vi.fn(),
  createDocumentObserver: vi.fn(),
  emitStatus: null as ((status: unknown) => void) | null,
  prepareReformatHost: vi.fn(),
  isTrackedEditingEnabled: vi.fn(),
}));

/**
 * Re-establish every mock's behaviour.
 *
 * `vitest.config.ts` sets `mockReset: true`, which clears implementations as
 * well as calls. A `vi.fn(impl)` therefore returns `undefined` by the time a
 * test body runs, so the observer would be `undefined` and `observerRef` would
 * hold nothing — the component under test would be broken by the fixture, and
 * the failure would read as a wiring bug.
 */
function installMockBehaviour(): void {
  mocks.createDocumentObserver.mockImplementation(
    (options?: { onStatus?: (s: unknown) => void }) => {
      // Keep the status callback so a test can drive a scan result, which is the
      // only way to exercise the preview decision without a real Word host.
      mocks.emitStatus = options?.onStatus ?? null;
      return {
        startObserver: vi.fn(),
        stopObserver: vi.fn(),
        onDocumentChanged: vi.fn(),
      };
    },
  );
  mocks.prepareReformatHost.mockResolvedValue(null);
  mocks.isTrackedEditingEnabled.mockReturnValue(false);
}

vi.mock("../../../../src/core/state/persistence", () => ({
  loadState: () => mocks.loadState(),
  saveState: vi.fn(),
  ignoreFinding: vi.fn(),
  restoreFinding: vi.fn(),
  subscribeToState: () => () => undefined,
}));

vi.mock("../../../../src/core/state", () => ({
  loadState: () => mocks.loadState(),
  saveState: vi.fn(),
  subscribeToState: () => () => undefined,
}));

/*
 * Delegates to the spy and returns whatever it produced.
 *
 * Returning a fresh literal here instead would make `mockImplementation` in a
 * test invisible, and the test would then assert against a spy the component
 * never kept a handle to.
 */
vi.mock("../../../../src/word/documentObserver", () => ({
  createDocumentObserver: (options: unknown) => mocks.createDocumentObserver(options),
}));

vi.mock("../../../../src/reformat", () => ({
  prepareReformatHost: mocks.prepareReformatHost,
  applyReviewedPlan: vi.fn(),
  isTrackedEditingEnabled: mocks.isTrackedEditingEnabled,
  reformatDocument: vi.fn(async () => ({
    plan: null,
    report: { findings: [], coverage: null },
  })),
}));

vi.mock("../../../../src/taskpane/components/ProfileEditor", () => ({
  default: function ProfileEditorStub({ onRecordSaved }: { onRecordSaved?: () => void }) {
    return (
      <button type="button" onClick={onRecordSaved}>
        Save profile
      </button>
    );
  },
}));

import Dashboard from "../../../../src/taskpane/pages/Dashboard";
import { __resetPersistedStore } from "../../../../src/taskpane/state/usePersistedState";

function stateWithProfile(autoScan: boolean) {
  const profile = StyleProfileSchema.parse(createEmptyProfile("Learned style profile"));
  const record = createRecord(profile.id, profile.name, profile.createdAt, profile);
  return {
    version: 11,
    profileRecords: { [record.id]: record },
    activeProfileId: record.id,
    semanticProfileRecords: {},
    activeSemanticProfileId: null,
    ignoredFindings: [],
    governanceProfiles: {},
    governanceHistory: {},
    activeGovernanceProfileId: null,
    settings: {
      llmProvider: "mock" as const,
      openAiCredentialMode: "broker" as const,
      semanticOptIn: false,
      autoScan,
    },
    providerConnections: [],
  };
}

describe("settings.autoScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockBehaviour();
    window.localStorage.clear();
    /*
     * `usePersistedState` caches its snapshot at module scope, and that cache is
     * what the Dashboard reads `autoScan` from. Without this reset the second
     * test sees the first test's `autoScan: true` and the gate looks broken when
     * it is working — module state is not a mock, so `clearAllMocks` does not
     * reach it.
     */
    __resetPersistedStore();
  });

  it("starts the observer when auto-scan is on", () => {
    mocks.loadState.mockReturnValue(stateWithProfile(true));

    render(<Dashboard initialPage="review" />);

    const observers = mocks.createDocumentObserver.mock.results.map((r) => r.value);
    expect(observers.some((o) => o?.startObserver.mock.calls.length > 0)).toBe(true);
  });

  it("creates the observer but does not start it when auto-scan is off", () => {
    // The stored intention the user set in Settings, honoured.
    mocks.loadState.mockReturnValue(stateWithProfile(false));

    render(<Dashboard initialPage="review" />);

    const observers = mocks.createDocumentObserver.mock.results.map((r) => r.value);
    expect(observers.length).toBeGreaterThan(0);
    expect(observers.every((o) => o?.startObserver.mock.calls.length === 0)).toBe(true);
  });

  it("still offers Re-scan now when auto-scan is off", () => {
    // If the manual control vanished with auto-scan, turning the setting off
    // would remove the only way to get a findings list at all.
    mocks.loadState.mockReturnValue(stateWithProfile(false));

    render(<Dashboard initialPage="review" />);

    expect(screen.getByRole("button", { name: "Re-scan now" })).toBeEnabled();
  });
});

describe("the whole-document action row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockBehaviour();
    window.localStorage.clear();
    __resetPersistedStore();
    mocks.loadState.mockReturnValue(stateWithProfile(true));
  });

  it("offers no whole-document Apply outside the section that lists what it writes", () => {
    /*
     * The row used to carry an "Apply all changes" button that applied the whole
     * plan, sitting beside a Pending Changes section whose own Apply did the same
     * thing. Two controls, two different meanings of "all", and the one outside
     * the list applied changes the user had not been shown.
     */
    render(<Dashboard initialPage="review" />);

    expect(screen.queryByRole("button", { name: /apply all/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-scan now" })).toBeEnabled();
  });

  it("accepts a status update from the observer", async () => {
    /*
     * The observer reports a status; the Dashboard must accept it without
     * error. This is the path that delivers findings to the UI.
     */
    render(<Dashboard initialPage="review" />);
    const emit = mocks.emitStatus;
    expect(emit).not.toBeNull();

    await act(async () => {
      emit?.({
        phase: "fresh",
        lastScan: "2026-01-01T00:00:00.000Z",
        dirtyCount: 0,
        stale: false,
        hostUnavailable: false,
        findings: [],
        coverage: { complete: true },
        reviewSessionIdentity: {
          documentId: "doc-1",
          documentVersion: "v1",
          contentHash: "content-1",
          structuralHash: "structure-1",
          profileId: "44444444-4444-4444-8444-444444444444",
          profileRevision: 1,
          governancePolicyRevision: 1,
          coverageFingerprint: "coverage-1",
        },
        currentRunId: "r1",
        lastAcceptedRunId: "r1",
        documentVersion: "v1",
        supersededRuns: 0,
        error: null,
      });
    });

    // The observer was created and remains functional.
    const observers = mocks.createDocumentObserver.mock.results.map((r) => r.value);
    expect(observers.length).toBeGreaterThan(0);
  });

  it("shows no findings before a scan completes", () => {
    /*
     * The findings list starts empty before any scan result arrives. The
     * PendingChanges section was removed with the apply-now flow; the
     * FindingTypeList is empty and the page shows the no-findings state.
     */
    render(<Dashboard initialPage="review" />);

    expect(screen.getByText(/no open findings/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Accept/ })).not.toBeInTheDocument();
  });

  it("drives a scan when Re-scan now is pressed", async () => {
    const user = userEvent.setup();
    /*
     * "Some observer was driven", not "the newest one was".
     *
     * The observer effect re-runs while the capability probe resolves, so
     * several observers exist and the one in the ref is whichever the last run
     * left there. Pinning to a specific instance would assert React's effect
     * ordering rather than the behaviour: what matters is that pressing the
     * button makes the pane ask its observer for a scan.
     */
    render(<Dashboard initialPage="review" />);
    const before = mocks.createDocumentObserver.mock.results.length;
    await user.click(screen.getByRole("button", { name: "Re-scan now" }));

    const observers = mocks.createDocumentObserver.mock.results
      .slice(0, before)
      .map((result) => result.value);
    expect(observers.length).toBeGreaterThan(0);
    expect(observers.some((observer) => observer?.onDocumentChanged.mock.calls.length > 0)).toBe(
      true,
    );
  });

  it("shows the finding in the type list after a scan", async () => {
    /*
     * The finding appears as a type row in the FindingTypeList. The overlay
     * behavior (Skip, Accept, etc.) is tested in findingDetailOverlay.test.tsx.
     * ponytail: don't test the same thing twice.
     */
    const finding = sampleFinding();
    render(<Dashboard initialPage="review" />);
    const emit = mocks.emitStatus;
    expect(emit).not.toBeNull();

    act(() => {
      emit?.({
        phase: "fresh",
        lastScan: "2026-01-01T00:00:00.000Z",
        dirtyCount: 1,
        stale: false,
        hostUnavailable: false,
        findings: [finding],
        coverage: { complete: true },
        deterministicCoverage: { complete: true },
        reviewSessionIdentity: {
          documentId: "doc-1",
          documentVersion: "v1",
          contentHash: "content-1",
          structuralHash: "structure-1",
          profileId: "44444444-4444-4444-8444-444444444444",
          profileRevision: 1,
          governancePolicyRevision: 1,
          coverageFingerprint: "coverage-1",
        },
        currentRunId: "r1",
        lastAcceptedRunId: "r1",
        documentVersion: "v1",
        supersededRuns: 0,
        error: null,
      });
    });

    /* The finding appears as a type row with the rule name as the heading. */
    const typeRow = await screen.findByRole("button", { name: /emDash/i });
    expect(typeRow).toBeInTheDocument();
  });
});

/**
 * How long to wait for Home, which is lazily imported.
 *
 * The destination renders behind a `Suspense` fallback, so the first paint is a
 * "Loading..." element and the page arrives on a later tick. Testing Library
 * defaults to one second, which is enough in a plain run and not enough under
 * the coverage instrumentation the verification graph also runs.
 */
const LAZY_PAGE = { timeout: 5000 } as const;

describe("the review page's breadcrumb", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMockBehaviour();
    window.localStorage.clear();
    __resetPersistedStore();
    mocks.loadState.mockReturnValue(stateWithProfile(true));
  });

  it("returns to Home from the review page that renders inline", async () => {
    /*
     * Deterministic Review is the one destination that renders inside the
     * dashboard rather than through a page component, so it was the one page
     * with no breadcrumb at all. Its parent comes from the same map every other
     * page uses (ADR-0137), so the label is the page the press lands on.
     */
    render(<Dashboard initialPage="review" />);

    await userEvent.click(screen.getByRole("button", { name: "Back to Home" }));

    expect(await screen.findByText("Active styles", undefined, LAZY_PAGE)).toBeInTheDocument();
  });
});
