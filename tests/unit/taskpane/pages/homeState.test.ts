import { describe, expect, it } from "vitest";
import { computeHomeCards, type HomeState } from "../../../../src/taskpane/pages/homeState";
import type { DocumentObserverStatus } from "../../../../src/word/documentObserver";
import type { ConsistencyReport } from "../../../../src/analysis/consistency/contracts/report";
import type { SetupStatus } from "../../../../src/taskpane/setupStatus";

/**
 * Home state-matrix test (plan §9 P4 gate, spec §11).
 *
 * Every branch of `computeHomeCards` is covered: the deterministic scan phases
 * (§11.1), the semantic selection states (§11.2), and the consistency report
 * states (§11.3). The attention line is covered too.
 *
 * Pure-function test — no Office mock, no LLM mock, no rendering. The mapping
 * is the contract; the component is a pure function of it. Mocks use
 * `as unknown as T` because the exact shape is irrelevant — only the fields
 * `computeHomeCards` reads are exercised.
 */

const SETUP_COMPLETE = {
  items: [],
  complete: true,
  blocksScanning: false,
} as unknown as SetupStatus;

const PROFILE_A = { name: "House Style", revision: 3 };
const PROFILE_B = { name: "Semantic Profile", revision: 1 };

function observerStatus(overrides: Record<string, unknown>): DocumentObserverStatus {
  return {
    phase: "clean",
    lastScan: null,
    dirtyCount: 0,
    stale: false,
    hostUnavailable: false,
    findings: [],
    groups: [],
    coverage: null,
    deterministicCoverage: null,
    reviewSessionIdentity: null,
    currentRunId: null,
    lastAcceptedRunId: null,
    documentVersion: "v1",
    supersededRuns: 0,
    error: null,
    ...overrides,
  } as unknown as DocumentObserverStatus;
}

function consistencyReport(overrides: Record<string, unknown>): ConsistencyReport {
  return {
    revision: "1",
    issues: [],
    coverage: { complete: true, unresolved: 0 },
    usedModel: false,
    startedAt: "2026-10-09T10:00:00Z",
    finishedAt: "2026-10-09T10:01:00Z",
    ...overrides,
  } as unknown as ConsistencyReport;
}

function homeState(overrides: Partial<HomeState>): HomeState {
  return {
    setup: SETUP_COMPLETE,
    deterministic: null,
    semantic: null,
    consistency: null,
    activeDeterministicProfile: PROFILE_A,
    activeSemanticProfile: null,
    ...overrides,
  };
}

describe("computeHomeCards — deterministic (spec §11.1)", () => {
  it("reports Not checked when no scan has run", () => {
    const cards = computeHomeCards(homeState({ deterministic: null }));
    expect(cards.deterministic.statusText).toBe("Not checked");
    expect(cards.deterministic.status).toBe("neutral");
  });

  it("reports In progress while scanning", () => {
    const cards = computeHomeCards(
      homeState({ deterministic: observerStatus({ phase: "scanning" }) }),
    );
    expect(cards.deterministic.statusText).toBe("In progress");
    expect(cards.deterministic.primaryAction.disabled).toBe(true);
  });

  it("reports Complete with no findings", () => {
    const cards = computeHomeCards(
      homeState({ deterministic: observerStatus({ phase: "clean", findings: [] }) }),
    );
    expect(cards.deterministic.statusText).toBe("Complete");
    expect(cards.deterministic.status).toBe("success");
  });

  it("reports Needs review with findings", () => {
    const cards = computeHomeCards(
      homeState({
        deterministic: observerStatus({
          phase: "clean",
          findings: [{ id: "f1" }],
        }),
      }),
    );
    expect(cards.deterministic.statusText).toBe("Needs review");
    expect(cards.deterministic.status).toBe("warning");
    expect(cards.deterministic.metadata).toContain("1 finding");
  });

  it("reports Stale when the document changed", () => {
    const cards = computeHomeCards(
      homeState({ deterministic: observerStatus({ phase: "clean", stale: true }) }),
    );
    expect(cards.deterministic.statusText).toBe("Stale");
    expect(cards.deterministic.status).toBe("warning");
    expect(cards.attention).not.toBeNull();
  });

  it("reports Incomplete when coverage is incomplete", () => {
    const cards = computeHomeCards(
      homeState({
        deterministic: observerStatus({
          phase: "incomplete",
          deterministicCoverage: { complete: false },
        }),
      }),
    );
    expect(cards.deterministic.statusText).toBe("Incomplete");
    expect(cards.deterministic.status).toBe("warning");
  });

  it("reports Error when the scan failed", () => {
    const cards = computeHomeCards(
      homeState({ deterministic: observerStatus({ phase: "failed" }) }),
    );
    expect(cards.deterministic.statusText).toBe("Error");
    expect(cards.deterministic.status).toBe("danger");
  });

  it("shows the profile label when a profile exists", () => {
    const cards = computeHomeCards(
      homeState({
        deterministic: observerStatus({ phase: "clean", findings: [] }),
        activeDeterministicProfile: PROFILE_A,
      }),
    );
    expect(cards.deterministic.profileLabel).toBe("House Style r3");
  });

  it("disables Run review when no deterministic profile exists", () => {
    const cards = computeHomeCards(
      homeState({
        deterministic: observerStatus({ phase: "clean", findings: [] }),
        activeDeterministicProfile: null,
      }),
    );
    expect(cards.deterministic.primaryAction.disabled).toBe(true);
  });
});

describe("computeHomeCards — semantic (spec §11.2)", () => {
  it("reports Unavailable when no semantic profile exists", () => {
    const cards = computeHomeCards(homeState({ semantic: null, activeSemanticProfile: null }));
    expect(cards.semantic.statusText).toBe("Unavailable");
    expect(cards.semantic.status).toBe("neutral");
  });

  it("reports Not checked when no selection has been made", () => {
    const cards = computeHomeCards(
      homeState({
        semantic: { heldChars: null, preservationRefused: false },
        activeSemanticProfile: PROFILE_B,
      }),
    );
    expect(cards.semantic.statusText).toBe("Not checked");
    // The button is enabled: a profile exists, so navigating to Semantic Review
    // lets the user select text there. The gate on selection lives on the page,
    // not here.
    expect(cards.semantic.primaryAction.disabled).toBe(false);
    expect(cards.semantic.primaryAction.destination).toBe("semantic-review");
  });

  it("reports Needs review when text is selected", () => {
    const cards = computeHomeCards(
      homeState({
        semantic: { heldChars: 42, preservationRefused: false },
        activeSemanticProfile: PROFILE_B,
      }),
    );
    expect(cards.semantic.statusText).toBe("Needs review");
    expect(cards.semantic.status).toBe("warning");
    expect(cards.semantic.primaryAction.disabled).toBe(false);
  });

  it("reports Needs review when preservation was refused", () => {
    const cards = computeHomeCards(
      homeState({
        semantic: { heldChars: 42, preservationRefused: true },
        activeSemanticProfile: PROFILE_B,
      }),
    );
    expect(cards.semantic.statusText).toBe("Needs review");
    expect(cards.semantic.status).toBe("warning");
    expect(cards.semantic.metadata).toContain("preservation");
  });

  it("shows the semantic profile label when one exists", () => {
    const cards = computeHomeCards(
      homeState({
        semantic: { heldChars: 10, preservationRefused: false },
        activeSemanticProfile: PROFILE_B,
      }),
    );
    expect(cards.semantic.profileLabel).toBe("Semantic Profile r1");
  });
});

describe("computeHomeCards — consistency (spec §11.3)", () => {
  it("reports Not checked when no report exists", () => {
    const cards = computeHomeCards(homeState({ consistency: null }));
    expect(cards.consistency.statusText).toBe("Not checked");
    expect(cards.consistency.status).toBe("neutral");
  });

  it("reports Complete when the report has no issues", () => {
    const cards = computeHomeCards(homeState({ consistency: consistencyReport({}) }));
    expect(cards.consistency.statusText).toBe("Complete");
    expect(cards.consistency.status).toBe("success");
  });

  it("reports Needs review when the report has issues", () => {
    const cards = computeHomeCards(
      homeState({
        consistency: consistencyReport({
          issues: [{ id: "i1" }],
        }),
      }),
    );
    expect(cards.consistency.statusText).toBe("Needs review");
    expect(cards.consistency.status).toBe("warning");
    expect(cards.consistency.metadata).toContain("1 unresolved issue");
  });
});

describe("computeHomeCards — attention line", () => {
  it("is null when the document is not stale", () => {
    const cards = computeHomeCards(
      homeState({ deterministic: observerStatus({ phase: "clean", stale: false }) }),
    );
    expect(cards.attention).toBeNull();
  });

  it("is set when the document is stale", () => {
    const cards = computeHomeCards(
      homeState({ deterministic: observerStatus({ phase: "clean", stale: true }) }),
    );
    expect(cards.attention).toBe("Report changed since last deterministic review");
  });

  it("is null when no scan has run", () => {
    const cards = computeHomeCards(homeState({ deterministic: null }));
    expect(cards.attention).toBeNull();
  });
});
