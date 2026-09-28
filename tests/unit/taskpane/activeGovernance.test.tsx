import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readActiveGovernanceContext } from "../../../src/taskpane/activeGovernance";
import GovernancePolicy from "../../../src/taskpane/pages/GovernancePolicy";

const mocks = vi.hoisted(() => ({
  loadState: vi.fn(),
  loadProfileRecord: vi.fn(),
  savePolicy: vi.fn(),
}));

vi.mock("../../../src/core/state/persistence", () => ({
  loadState: () => mocks.loadState(),
  loadProfileRecord: (id: string) => mocks.loadProfileRecord(id),
}));

vi.mock("../../../src/core/state/profileSelectors", () => ({
  selectGovernancePolicy: (state: { governanceProfiles?: Record<string, unknown> }, id: string) =>
    state.governanceProfiles?.[id] ?? null,
}));

vi.mock("../../../src/taskpane/components/GovernancePolicySection", () => ({
  default: ({
    policy,
    onPolicySaved,
  }: {
    policy: { id: string };
    onPolicySaved: (next: { id: string; version: number }) => void;
  }) => (
    <section aria-label="Governance policy editor">
      <p>Editing {policy.id}</p>
      <button type="button" onClick={() => onPolicySaved({ id: policy.id, version: 2 } as never)}>
        Save policy
      </button>
    </section>
  ),
}));

function installStore(options: {
  activeProfileId: string | null;
  record?: unknown;
  policy?: unknown;
}): void {
  mocks.loadState.mockReturnValue({
    version: 11,
    activeProfileId: options.activeProfileId,
    governanceProfiles:
      options.policy === undefined ? {} : { [options.activeProfileId ?? ""]: options.policy },
  });
  mocks.loadProfileRecord.mockReturnValue(options.record ?? null);
}

describe("readActiveGovernanceContext", () => {
  beforeEach(() => {
    mocks.loadState.mockReset();
    mocks.loadProfileRecord.mockReset();
  });

  it("returns the record and the policy that governs it", () => {
    const record = { id: "p1", name: "House" };
    installStore({
      activeProfileId: "p1",
      record,
      policy: { id: "g1", version: 3 },
    });

    const context = readActiveGovernanceContext();

    expect(context.record).toBe(record);
    expect(context.policy).toEqual({ id: "g1", version: 3 });
  });

  it("selects the policy by the record it read, not by a second lookup", () => {
    /*
     * The two calls are paired deliberately. Reading the state and the record
     * separately can pair a just-saved record with the policy that belonged to
     * the previous one, because `saveProfileRecord` rewrites the policy's
     * wrapped style.
     */
    const record = { id: "p1" };
    installStore({ activeProfileId: "p1", record, policy: { id: "g1" } });

    const context = readActiveGovernanceContext();

    expect(mocks.loadProfileRecord).toHaveBeenCalledWith("p1");
    expect(context.policy?.id).toBe("g1");
  });

  it("reports both halves as absent when no profile is active", () => {
    installStore({ activeProfileId: null });

    const context = readActiveGovernanceContext();

    expect(context.record).toBeNull();
    expect(context.policy).toBeNull();
    // Nothing to govern, so the record store is not read at all.
    expect(mocks.loadProfileRecord).not.toHaveBeenCalled();
  });

  it("reports no policy when the active id has no record", () => {
    installStore({ activeProfileId: "p-missing" });

    const context = readActiveGovernanceContext();

    expect(context.record).toBeNull();
    expect(context.policy).toBeNull();
  });
});

describe("GovernancePolicy page", () => {
  beforeEach(() => {
    mocks.loadState.mockReset();
    mocks.loadProfileRecord.mockReset();
    mocks.savePolicy.mockReset();
  });

  it("renders the policy editor when a record and a policy both exist", () => {
    installStore({
      activeProfileId: "p1",
      record: { id: "p1", name: "House" },
      policy: { id: "g1", version: 1 },
    });

    render(<GovernancePolicy onBack={() => undefined} />);

    expect(screen.getByRole("region", { name: "Governance policy editor" })).toBeTruthy();
  });

  it("says there is no policy to show rather than rendering an empty form", () => {
    installStore({ activeProfileId: null });

    render(<GovernancePolicy onBack={() => undefined} />);

    expect(screen.queryByRole("region", { name: "Governance policy editor" })).toBeNull();
    expect(screen.getByText(/No policy to show/)).toBeTruthy();
    // The message has to name the way out, or it reads as a failure.
    expect(screen.getByText(/Deterministic Style Profile tab/)).toBeTruthy();
  });

  it("keeps a saved policy in place instead of re-reading the stale store", async () => {
    /*
     * The section is persisted by its own writer, so the page must trust the
     * value it is handed. Re-reading here would restore the pre-save policy the
     * instant the user saved it.
     */
    installStore({
      activeProfileId: "p1",
      record: { id: "p1", name: "House" },
      policy: { id: "g1", version: 1 },
    });

    render(<GovernancePolicy onBack={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Save policy" }));

    const editor = screen.getByRole("region", { name: "Governance policy editor" });
    expect(within(editor).getByText("Editing g1")).toBeTruthy();
    expect(mocks.loadState).toHaveBeenCalledTimes(1);
  });

  it("offers a route back to Document Governance", async () => {
    const onBack = vi.fn();
    installStore({ activeProfileId: null });

    render(<GovernancePolicy onBack={onBack} />);
    await userEvent.click(screen.getByRole("button", { name: "Back to Document Governance" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
