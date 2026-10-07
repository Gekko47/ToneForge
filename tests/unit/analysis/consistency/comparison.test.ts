import { describe, expect, it } from "vitest";
import {
  buildClaimPairDiff,
  compareValues,
  compareDatesByRole,
  type ClaimPairDiff,
} from "../../../../src/analysis/consistency/comparison/claimPairDiff";
import {
  resolveCandidate,
  runComparabilityGates,
} from "../../../../src/analysis/consistency/comparison/deterministicEvaluationResolver";
import {
  runPreModelGates,
  runPostModelGates,
} from "../../../../src/analysis/consistency/comparison/hardGates";
import { evaluationProfile } from "../../../../src/analysis/consistency/comparison/evaluationProfiles";
import type { ExpertReportClaim } from "../../../../src/analysis/consistency/contracts";
import type { NormalisedClaim } from "../../../../src/analysis/consistency/normalisation";
import { claim } from "../../../../tests/fixtures/consistencyClaims";

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

describe("R4 comparison: ClaimPairDiff", () => {
  it("builds a diff with matches, differences, and unknowns", () => {
    const left = normalisedClaim({
      id: "c-1",
      subjectIds: ["entity-works"],
      eventIds: ["event-handover"],
      programmeIds: ["prog-1"],
      values: [{ raw: "42", normalized: 42, unit: "days" }],
      scope: { kind: "universal" },
      adoptionStatus: "author_opinion",
    });
    const right = normalisedClaim({
      id: "c-2",
      subjectIds: ["entity-works"],
      eventIds: ["event-handover"],
      programmeIds: ["prog-1"],
      values: [{ raw: "42", normalized: 42, unit: "days" }],
      scope: { kind: "universal" },
      adoptionStatus: "author_opinion",
    });

    const diff = buildClaimPairDiff(left.claim, right.claim);

    expect(diff.matches.length).toBeGreaterThan(0);
    expect(diff.differences.length).toBe(0);
    expect(diff.unknowns.length).toBeGreaterThanOrEqual(0);
  });

  it("detects value differences", () => {
    const left = normalisedClaim({
      id: "c-1",
      values: [{ raw: "42", normalized: 42, unit: "days" }],
    });
    const right = normalisedClaim({
      id: "c-2",
      values: [{ raw: "37", normalized: 37, unit: "days" }],
    });

    const diff = buildClaimPairDiff(left.claim, right.claim);
    const valueDiff = diff.differences.find((d) => d.field === "value");
    expect(valueDiff).toBeDefined();
    expect(valueDiff?.left).toBe("42");
    expect(valueDiff?.right).toBe("37");
  });

  it("detects entity mismatches", () => {
    const left = normalisedClaim({ id: "c-1", subjectIds: ["entity-a"] });
    const right = normalisedClaim({ id: "c-2", subjectIds: ["entity-b"] });

    const diff = buildClaimPairDiff(left.claim, right.claim);
    const entityDiff = diff.differences.find((d) => d.field === "entity");
    expect(entityDiff).toBeDefined();
  });

  it("compareValues handles unit conversion", () => {
    const left = { raw: "1", normalized: 1, unit: "km" };
    const right = { raw: "1000", normalized: 1000, unit: "m" };
    expect(compareValues(left, right)).toBe("same");
  });

  it("compareValues detects incompatible units", () => {
    const left = { raw: "1", normalized: 1, unit: "kg" };
    const right = { raw: "1000", normalized: 1000, unit: "m" };
    expect(compareValues(left, right)).toBe("incomparable");
  });

  it("compareDatesByRole handles coarse vs precise", () => {
    const left = {
      raw: "March 2026",
      iso: "2026-03-00",
      year: 2026,
      month: 3,
      day: 0,
      coarse: true,
    };
    const right = {
      raw: "4 March 2026",
      iso: "2026-03-04",
      year: 2026,
      month: 3,
      day: 4,
      coarse: false,
    };
    expect(compareDatesByRole(left, right)).toBe("incomparable");
  });
});

describe("R4 comparison: deterministicEvaluationResolver", () => {
  it("resolves a candidate with two identical claims as consistent", () => {
    const left = normalisedClaim({
      id: "c-1",
      subjectIds: ["entity-works"],
      eventIds: ["event-handover"],
      programmeIds: ["prog-1"],
      values: [{ raw: "42", normalized: 42, unit: "days" }],
      scope: { kind: "universal" },
      adoptionStatus: "author_opinion",
      evidence: {
        documentId: "doc-1",
        sectionPath: [],
        paragraphId: "p-1",
        startOffset: 0,
        endOffset: 10,
        exactText: "text 1",
        evidenceHash: "hash1",
      },
      evidenceBasis: [{ anchorId: "anchor-1", role: "primary" }],
    });
    const right = normalisedClaim({
      id: "c-2",
      subjectIds: ["entity-works"],
      eventIds: ["event-handover"],
      programmeIds: ["prog-1"],
      values: [{ raw: "42", normalized: 42, unit: "days" }],
      scope: { kind: "universal" },
      adoptionStatus: "author_opinion",
      evidence: {
        documentId: "doc-1",
        sectionPath: [],
        paragraphId: "p-1",
        startOffset: 0,
        endOffset: 10,
        exactText: "text 2",
        evidenceHash: "hash2",
      },
      evidenceBasis: [{ anchorId: "anchor-2", role: "primary" }],
    });

    const candidate = {
      id: "C2-0001",
      checkId: "C2" as const,
      subject: { kind: "entity" as const, name: "entity-works", aliases: [] },
      fingerprint: "test",
      claimIds: ["c-1", "c-2"],
      retrieval: {
        reasonCodes: [],
        sharedEntityIds: [],
        sharedEventIds: [],
        sharedProgrammeIds: [],
        sharedMetricIds: [],
      },
      evidenceIds: [],
      state: "pending" as const,
    };

    const resolution = resolveCandidate(candidate, [left, right]);

    expect(resolution.state).toBe("consistent");
    expect(resolution.diff).not.toBeNull();
    expect(resolution.answers.length).toBeGreaterThan(0);
  });

  it("classifies a candidate with value difference as conflict", () => {
    const left = normalisedClaim({
      id: "c-1",
      subjectIds: ["entity-works"],
      values: [{ raw: "42", normalized: 42, unit: "days" }],
      evidence: {
        documentId: "doc-1",
        sectionPath: [],
        paragraphId: "p-1",
        startOffset: 0,
        endOffset: 10,
        exactText: "text 1",
        evidenceHash: "hash1",
      },
      evidenceBasis: [{ anchorId: "anchor-1", role: "primary" }],
    });
    const right = normalisedClaim({
      id: "c-2",
      subjectIds: ["entity-works"],
      values: [{ raw: "37", normalized: 37, unit: "days" }],
      evidence: {
        documentId: "doc-1",
        sectionPath: [],
        paragraphId: "p-1",
        startOffset: 0,
        endOffset: 10,
        exactText: "text 2",
        evidenceHash: "hash2",
      },
      evidenceBasis: [{ anchorId: "anchor-2", role: "primary" }],
    });

    const candidate = {
      id: "C2-0001",
      checkId: "C2" as const,
      subject: { kind: "entity" as const, name: "entity-works", aliases: [] },
      fingerprint: "test",
      claimIds: ["c-1", "c-2"],
      retrieval: {
        reasonCodes: [],
        sharedEntityIds: [],
        sharedEventIds: [],
        sharedProgrammeIds: [],
        sharedMetricIds: [],
      },
      evidenceIds: [],
      state: "pending" as const,
    };

    const resolution = resolveCandidate(candidate, [left, right]);

    expect(resolution.state).toBe("conflict");
    expect(resolution.reasonCodes.some((r) => r.includes("substantive-conflict"))).toBe(true);
  });

  it("classifies a candidate with different scenarios as not_comparable", () => {
    const left = normalisedClaim({
      id: "c-1",
      subjectIds: ["entity-works"],
      scenario: { type: "primary" },
      evidence: {
        documentId: "doc-1",
        sectionPath: [],
        paragraphId: "p-1",
        startOffset: 0,
        endOffset: 10,
        exactText: "text 1",
        evidenceHash: "hash1",
      },
    });
    const right = normalisedClaim({
      id: "c-2",
      subjectIds: ["entity-works"],
      scenario: { type: "alternative" },
      evidence: {
        documentId: "doc-1",
        sectionPath: [],
        paragraphId: "p-1",
        startOffset: 0,
        endOffset: 10,
        exactText: "text 2",
        evidenceHash: "hash2",
      },
    });

    const candidate = {
      id: "C2-0001",
      checkId: "C2" as const,
      subject: { kind: "entity" as const, name: "entity-works", aliases: [] },
      fingerprint: "test",
      claimIds: ["c-1", "c-2"],
      retrieval: {
        reasonCodes: [],
        sharedEntityIds: [],
        sharedEventIds: [],
        sharedProgrammeIds: [],
        sharedMetricIds: [],
      },
      evidenceIds: [],
      state: "pending" as const,
    };

    const resolution = resolveCandidate(candidate, [left, right]);

    expect(resolution.state).toBe("not_comparable");
    expect(resolution.reasonCodes.some((r) => r.includes("different-scenario"))).toBe(true);
  });

  it("classifies a candidate with insufficient claims as not_comparable", () => {
    const left = normalisedClaim({ id: "c-1" });

    const candidate = {
      id: "C2-0001",
      checkId: "C2" as const,
      subject: { kind: "entity" as const, name: "entity-works", aliases: [] },
      fingerprint: "test",
      claimIds: ["c-1"],
      retrieval: {
        reasonCodes: [],
        sharedEntityIds: [],
        sharedEventIds: [],
        sharedProgrammeIds: [],
        sharedMetricIds: [],
      },
      evidenceIds: [],
      state: "pending" as const,
    };

    const resolution = resolveCandidate(candidate, [left]);

    expect(resolution.state).toBe("not_comparable");
    expect(resolution.reasonCodes).toContain("insufficient-claims");
  });

  it("runComparabilityGates returns not_comparable for different scenarios", () => {
    const left = normalisedClaim({
      id: "c-1",
      scenario: { type: "primary" },
    });
    const right = normalisedClaim({
      id: "c-2",
      scenario: { type: "alternative" },
    });

    const diff: ClaimPairDiff = { matches: [], differences: [], unknowns: [] };
    const result = runComparabilityGates([left, right], "C2", diff);

    expect(result).not.toBeNull();
    expect(result?.state).toBe("not_comparable");
    expect(result?.reasonCodes.some((r) => r.includes("different-scenario"))).toBe(true);
  });
});

describe("R4 comparison: hardGates", () => {
  it("runPreModelGates blocks different scenarios", () => {
    const left = normalisedClaim({
      id: "c-1",
      scenario: { type: "primary" },
    });
    const right = normalisedClaim({
      id: "c-2",
      scenario: { type: "alternative" },
    });

    const diff: ClaimPairDiff = { matches: [], differences: [], unknowns: [] };
    const result = runPreModelGates([left, right], "C2", diff);

    expect(result.proceedToModel).toBe(false);
    expect(result.state).toBe("not_comparable");
    expect(result.reasonCodes.some((r) => r.includes("different-scenario"))).toBe(true);
  });

  it("runPreModelGates blocks different attribution domains", () => {
    const left = normalisedClaim({
      id: "c-1",
      speaker: { id: "p-1", name: "Expert A" },
      evidence: {
        documentId: "doc-1",
        sectionPath: [],
        paragraphId: "p-1",
        startOffset: 0,
        endOffset: 10,
        exactText: "text 1",
        evidenceHash: "hash1",
      },
    });
    const right = normalisedClaim({
      id: "c-2",
      speaker: { id: "p-2", name: "Expert B" },
      evidence: {
        documentId: "doc-1",
        sectionPath: [],
        paragraphId: "p-1",
        startOffset: 0,
        endOffset: 10,
        exactText: "text 2",
        evidenceHash: "hash2",
      },
    });

    const diff: ClaimPairDiff = { matches: [], differences: [], unknowns: [] };
    const result = runPreModelGates([left, right], "C2", diff);

    expect(result.proceedToModel).toBe(false);
    expect(result.state).toBe("not_comparable");
    expect(result.reasonCodes).toContain("different-attribution-domain");
  });

  it("runPreModelGates blocks forecast vs actual", () => {
    const left = normalisedClaim({
      id: "c-1",
      temporal: {
        forecastDate: {
          raw: "2026-03-01",
          iso: "2026-03-01",
          year: 2026,
          month: 3,
          day: 1,
          coarse: false,
        },
      },
      evidence: {
        documentId: "doc-1",
        sectionPath: [],
        paragraphId: "p-1",
        startOffset: 0,
        endOffset: 10,
        exactText: "forecast text",
        evidenceHash: "hash1",
      },
      evidenceBasis: [{ anchorId: "anchor-1", role: "primary" }],
      dates: [
        {
          role: "forecastDate",
          date: {
            raw: "2026-03-01",
            iso: "2026-03-01",
            year: 2026,
            month: 3,
            day: 1,
            coarse: false,
          },
        },
      ],
    });

    const right = normalisedClaim({
      id: "c-2",
      temporal: {
        dataDate: {
          raw: "2026-03-01",
          iso: "2026-03-01",
          year: 2026,
          month: 3,
          day: 1,
          coarse: false,
        },
      },
      evidence: {
        documentId: "doc-1",
        sectionPath: [],
        paragraphId: "p-1",
        startOffset: 0,
        endOffset: 10,
        exactText: "data text",
        evidenceHash: "hash2",
      },
      evidenceBasis: [{ anchorId: "anchor-2", role: "primary" }],
      dates: [
        {
          role: "dataDate",
          date: {
            raw: "2026-03-01",
            iso: "2026-03-01",
            year: 2026,
            month: 3,
            day: 1,
            coarse: false,
          },
        },
      ],
    });

    const diff: ClaimPairDiff = { matches: [], differences: [], unknowns: [] };
    const result = runPreModelGates([left, right], "C2", diff);

    expect(result.proceedToModel).toBe(false);
    expect(result.state).toBe("not_comparable");
    expect(result.reasonCodes).toContain("forecast-vs-actual");
  });

  it("runPostModelGates rejects model answers that contradict proven facts", () => {
    const deterministicAnswers = [
      { question: "E-VALUE-INCOMPATIBLE", holds: false, reason: "values are equivalent" },
    ];
    const modelAnswers = [
      { question: "E-VALUE-INCOMPATIBLE", holds: true, reason: "model thinks they differ" },
    ];

    const result = runPostModelGates(
      [
        normalisedClaim({
          id: "c-1",
          evidence: {
            documentId: "doc-1",
            sectionPath: [],
            paragraphId: "p-1",
            startOffset: 0,
            endOffset: 10,
            exactText: "text 1",
            evidenceHash: "hash1",
          },
        }),
        normalisedClaim({
          id: "c-2",
          evidence: {
            documentId: "doc-1",
            sectionPath: [],
            paragraphId: "p-1",
            startOffset: 0,
            endOffset: 10,
            exactText: "text 2",
            evidenceHash: "hash2",
          },
        }),
      ],
      "C2",
      modelAnswers,
      deterministicAnswers,
    );

    expect(result.accept).toBe(false);
    expect(result.overrideState).toBe("consistent");
    expect(result.reasonCodes).toContain("model-contradicts-proven:E-VALUE-INCOMPATIBLE");
  });

  it("runPostModelGates accepts model answers that agree with proven facts", () => {
    const deterministicAnswers = [
      { question: "E-VALUE-INCOMPATIBLE", holds: false, reason: "values are equivalent" },
    ];
    const modelAnswers = [
      {
        question: "E-VALUE-INCOMPATIBLE",
        holds: false,
        reason: "model agrees they are equivalent",
      },
    ];

    const result = runPostModelGates(
      [
        normalisedClaim({
          id: "c-1",
          evidence: {
            documentId: "doc-1",
            sectionPath: [],
            paragraphId: "p-1",
            startOffset: 0,
            endOffset: 10,
            exactText: "text 1",
            evidenceHash: "hash1",
          },
        }),
        normalisedClaim({
          id: "c-2",
          evidence: {
            documentId: "doc-1",
            sectionPath: [],
            paragraphId: "p-1",
            startOffset: 0,
            endOffset: 10,
            exactText: "text 2",
            evidenceHash: "hash2",
          },
        }),
      ],
      "C2",
      modelAnswers,
      deterministicAnswers,
    );

    expect(result.accept).toBe(true);
  });
});

describe("R4 comparison: evaluationProfiles", () => {
  it("has a profile for every check C1-C10", () => {
    const checkIds = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"] as const;
    for (const checkId of checkIds) {
      const profile = evaluationProfile(checkId);
      expect(profile.checkId).toBe(checkId);
      expect(profile.requiredFacts.length).toBeGreaterThan(0);
      expect(profile.relevantEQuestions.length).toBeGreaterThan(0);
      expect(profile.hardGates.length).toBeGreaterThan(0);
      expect(typeof profile.deriveDOutcome).toBe("function");
      expect(profile.allowedContextRequests.length).toBeGreaterThan(0);
      expect(profile.confidenceProfile.version).toBeDefined();
      expect(profile.confidenceProfile.reviewThreshold).toBeGreaterThan(0);
      expect(profile.confidenceProfile.presentationThreshold).toBeGreaterThan(
        profile.confidenceProfile.reviewThreshold,
      );
    }
  });

  it("C2 profile derives D-DIFFERENT-PERIOD when periods differ", () => {
    const profile = evaluationProfile("C2");
    const vector = {
      sameSubject: true,
      samePeriod: false,
      sameScenario: true,
      sameBasis: true,
      sameAttribution: true,
      valuesAgree: true,
      unitsCompatible: true,
      qualifiersCompatible: true,
    };
    expect(profile.deriveDOutcome(vector)).toBe("D-DIFFERENT-PERIOD");
  });

  it("C2 profile derives D-CONFLICT when values disagree with compatible units", () => {
    const profile = evaluationProfile("C2");
    const vector = {
      sameSubject: true,
      samePeriod: true,
      sameScenario: true,
      sameBasis: true,
      sameAttribution: true,
      valuesAgree: false,
      unitsCompatible: true,
      qualifiersCompatible: true,
    };
    expect(profile.deriveDOutcome(vector)).toBe("D-CONFLICT");
  });

  it("C10 profile derives D-DIFFERENT-SCOPE when scope differs", () => {
    const profile = evaluationProfile("C10");
    const vector = {
      sameSubject: true,
      sameScope: false,
      qualifiersCompatible: true,
    };
    expect(profile.deriveDOutcome(vector)).toBe("D-DIFFERENT-SCOPE");
  });
});
