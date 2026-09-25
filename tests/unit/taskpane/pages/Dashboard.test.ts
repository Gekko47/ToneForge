import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  createGovernanceProfile,
  type GovernanceProfile,
} from "../../../../src/core/domain/GovernanceProfile";
import { createEmptyProfile, StyleProfileSchema } from "../../../../src/core/domain/StyleProfile";
import { createChangePlan, type ChangePlan } from "../../../../src/core/domain/ChangePlan";
import { loadState, type PersistedState } from "../../../../src/core/state/persistence";
import {
  resolveGovernanceProfile,
  resolvePendingPlan,
} from "../../../../src/taskpane/pages/Dashboard";

function makeState(
  governanceProfiles: Record<string, GovernanceProfile>,
  activeProfileId: string | null,
  activeGovernanceProfileId: string | null,
): PersistedState {
  return {
    ...loadState(),
    profileRecords: {},
    activeProfileId,
    governanceProfiles,
    governanceHistory: {},
    activeGovernanceProfileId,
  };
}

function makePlan(id: string): ChangePlan {
  return createChangePlan(`hash-${id}`, "base", []);
}

describe("resolvePendingPlan", () => {
  it("keeps the selected plan paired with its own coverage", () => {
    const reformatPlan = makePlan("reformat");
    const fullPlan = makePlan("full");
    const pending = resolvePendingPlan(
      {
        plan: reformatPlan,
        report: { coverage: { complete: true, unprocessed: [] } },
      } as never,
      { plan: fullPlan, coverage: { complete: false, unprocessed: ["full"] } } as never,
      null,
    );

    expect(pending?.source).toBe("reformat");
    expect(pending?.plan).toBe(reformatPlan);
    expect(pending?.coverage).toEqual({ complete: true, unprocessed: [] });
  });
});

describe("resolveGovernanceProfile", () => {
  it("uses the first stored profile in active governance, active style, then style ID order", () => {
    const style = StyleProfileSchema.parse(createEmptyProfile("Style"));
    const governance = createGovernanceProfile(style);
    const activeStyleFallback = createGovernanceProfile(style);
    const styleFallback = createGovernanceProfile(style);
    const missingGovernanceId = uuidv4();

    const states = [
      makeState(
        {
          [governance.id]: governance,
          [activeStyleFallback.id]: activeStyleFallback,
          [style.id]: styleFallback,
        },
        activeStyleFallback.id,
        governance.id,
      ),
      makeState(
        {
          [activeStyleFallback.id]: activeStyleFallback,
          [style.id]: styleFallback,
        },
        activeStyleFallback.id,
        missingGovernanceId,
      ),
      makeState({ [style.id]: styleFallback }, missingGovernanceId, missingGovernanceId),
    ];

    expect(states.map((state) => resolveGovernanceProfile(state, style).id)).toEqual([
      governance.id,
      activeStyleFallback.id,
      styleFallback.id,
    ]);
  });

  it("creates a governance profile only when no lookup key has a stored profile", () => {
    const style = StyleProfileSchema.parse(createEmptyProfile("Unseeded"));
    const resolved = resolveGovernanceProfile(makeState({}, uuidv4(), uuidv4()), style);

    expect(resolved.style).toEqual(style);
    expect(resolved.id).not.toBe(style.id);
  });
});
