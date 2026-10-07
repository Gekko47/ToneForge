import { describe, expect, it } from "vitest";
import { compileDecisionPlanWithCandidates } from "@/analysis/consistency/decision/DecisionPlanCompiler";
import type { DeterministicResolution } from "@/analysis/consistency/comparison/deterministicEvaluationResolver";
import type { ConsistencyCandidate } from "@/analysis/consistency/contracts";
import type { NormalisedClaim } from "@/analysis/consistency/normalisation";
import type { ExpertReportClaim } from "@/analysis/consistency/contracts";
import { claim } from "../../../../fixtures/consistencyClaims";

function normalisedClaim(
  overrides: Partial<ExpertReportClaim> & { dates?: NormalisedClaim["dates"] } = {},
): NormalisedClaim {
  const { dates, ...claimOverrides } = overrides;
  const c = claim(claimOverrides);
  return {
    claim: c,
    values: c.values.map((v: (typeof c.values)[0]) => ({
      ...v,
      normalized: v.normalized ?? Number(v.raw.replace(/[,\s]/g, "")),
    })),
    dates: dates ?? [],
    durationDays: null,
  };
}

function deterministicResolution(
  overrides: Partial<DeterministicResolution> = {},
): DeterministicResolution {
  return {
    candidateId: "cand-1",
    checkId: "C2",
    diff: { matches: [], differences: [], unknowns: [] },
    answers: [],
    unresolved: [{ question: "E-VALUE-INCOMPATIBLE", reason: "needs model" }],
    state: "unresolved",
    reasonCodes: ["unresolved:E-VALUE-INCOMPATIBLE"],
    ...overrides,
  };
}

function consistencyCandidate(overrides: Partial<ConsistencyCandidate> = {}): ConsistencyCandidate {
  return {
    id: "cand-1",
    checkId: "C2",
    claimIds: ["claim-1", "claim-2"],
    subject: { kind: "unknown", reason: "test" },
    fingerprint: "test-fingerprint",
    state: "pending" as const,
    retrieval: {
      reasonCodes: [],
      sharedEntityIds: [],
      sharedEventIds: [],
      sharedProgrammeIds: [],
      sharedMetricIds: [],
    },
    evidenceIds: [],
    ...overrides,
  };
}

describe("R5 decision: DecisionPlanCompiler", () => {
  it("compiles a plan with unresolved questions", () => {
    const resolutions = [deterministicResolution()];
    const candidates = [consistencyCandidate()];
    const claims = [
      normalisedClaim({ id: "claim-1", values: [{ raw: "10", normalized: 10, unit: "days" }] }),
      normalisedClaim({ id: "claim-2", values: [{ raw: "15", normalized: 15, unit: "days" }] }),
    ];

    const plan = compileDecisionPlanWithCandidates(resolutions, candidates, claims, {
      revision: "doc-1",
      maxQuestions: 60,
      maxExpansions: 20,
      allowUnredacted: false,
    });

    expect(plan.revision).toBe("doc-1");
    expect(plan.questions.length).toBeGreaterThan(0);
    expect(plan.budget.maxQuestions).toBe(60);
    expect(plan.budget.maxExpansions).toBe(20);
    expect(plan.allowUnredacted).toBe(false);
  });

  it("respects maxQuestions budget", () => {
    const resolutions = Array.from({ length: 10 }, (_, i) =>
      deterministicResolution({
        candidateId: `cand-${i}`,
        unresolved: [{ question: "E-VALUE-INCOMPATIBLE", reason: "needs model" }],
      }),
    );
    const candidates = Array.from({ length: 10 }, (_, i) =>
      consistencyCandidate({ id: `cand-${i}`, claimIds: [`claim-${i * 2}`, `claim-${i * 2 + 1}`] }),
    );
    const claims = Array.from({ length: 20 }, (_, i) =>
      normalisedClaim({
        id: `claim-${i}`,
        values: [{ raw: String(i), normalized: i, unit: "days" }],
      }),
    );

    const plan = compileDecisionPlanWithCandidates(resolutions, candidates, claims, {
      revision: "doc-1",
      maxQuestions: 5,
      maxExpansions: 20,
      allowUnredacted: false,
    });

    expect(plan.questions.length).toBeLessThanOrEqual(5);
  });

  it("returns empty questions when no unresolved resolutions", () => {
    const resolutions = [
      {
        ...deterministicResolution(),
        state: "consistent" as const,
        unresolved: [],
      },
    ];
    const candidates = [consistencyCandidate()];
    const claims = [normalisedClaim({ id: "claim-1" }), normalisedClaim({ id: "claim-2" })];

    const plan = compileDecisionPlanWithCandidates(resolutions, candidates, claims, {
      revision: "doc-1",
      maxQuestions: 60,
      maxExpansions: 20,
      allowUnredacted: false,
    });

    expect(plan.questions.length).toBe(0);
  });

  it("includes only relevant E-questions for the check", () => {
    const resolutions = [
      deterministicResolution({
        checkId: "C1",
        unresolved: [{ question: "E-ENTITY-SAME", reason: "needs model" }],
      }),
    ];
    const candidates = [consistencyCandidate({ checkId: "C1" })];
    const claims = [normalisedClaim({ id: "claim-1" }), normalisedClaim({ id: "claim-2" })];

    const plan = compileDecisionPlanWithCandidates(resolutions, candidates, claims, {
      revision: "doc-1",
      maxQuestions: 60,
      maxExpansions: 20,
      allowUnredacted: false,
    });

    // C1 only cares about specific E-questions
    for (const q of plan.questions) {
      expect([
        "E-ENTITY-SAME",
        "E-PREDICATE-COMPARABLE",
        "E-DEFINITION-INCOMPATIBLE",
        "E-EVIDENCE-SUFFICIENT",
        "E-SUBSTANTIVE-CONFLICT",
      ]).toContain(q.id);
    }
  });

  it("sets subjectId on each question", () => {
    const resolutions = [deterministicResolution({ candidateId: "cand-123" })];
    const candidates = [consistencyCandidate({ id: "cand-123" })];
    const claims = [normalisedClaim({ id: "claim-1" }), normalisedClaim({ id: "claim-2" })];

    const plan = compileDecisionPlanWithCandidates(resolutions, candidates, claims, {
      revision: "doc-1",
      maxQuestions: 60,
      maxExpansions: 20,
      allowUnredacted: false,
    });

    for (const q of plan.questions) {
      expect(q.subjectId).toBe("cand-123");
    }
  });
});
