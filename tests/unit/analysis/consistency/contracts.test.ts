import { describe, expect, it } from "vitest";
import {
  CONSISTENCY_ACTIONABLE_CONFIDENCE,
  CONSISTENCY_CHECK_IDS,
  CONSISTENCY_CHECKS,
  CONSISTENCY_CONSENT_ERROR,
  CONSISTENCY_DEFAULT_MAX_ADJUDICATIONS,
  CONSISTENCY_DEFAULT_MAX_PER_SUBJECT,
  ConsistencyAdjudicationSchema,
  ConsistencyCheckIdSchema,
  ConsistencyCoverageSchema,
  ConsistencyIssueSchema,
  ConsistencyProgressSchema,
  ConsistencyReportSchema,
  ConsistencyReviewRequestSchema,
  ConfidenceProfileSchema,
  DOutcomeSchema,
  DecisionPlanSchema,
  DecisionQuestionSchema,
  DecisionSubjectSchema,
  EvaluationVectorSchema,
  EvidenceRegistrySchema,
  ExpertReportClaimSchema,
  consistencyCheck,
  parseConsistencyReviewRequest,
} from "../../../../src/analysis/consistency/contracts";

/**
 * R0 skeleton tests: the contracts parse what they claim to parse, and the
 * consent gate fails closed.
 */
describe("consistency contracts", () => {
  it("exposes ten checks with deterministic-first flags", () => {
    expect(CONSISTENCY_CHECK_IDS).toHaveLength(10);
    expect(CONSISTENCY_CHECKS.map((check) => check.id)).toEqual(CONSISTENCY_CHECK_IDS);
    const c1 = consistencyCheck("C1");
    expect(c1.deterministicFirst).toBe(true);
    expect(() => consistencyCheck("C99")).toThrow();
    expect(ConsistencyCheckIdSchema.parse("C10")).toBe("C10");
    expect(() => ConsistencyCheckIdSchema.parse("C99")).toThrow();
  });

  it("keeps the actionable threshold and budget defaults", () => {
    expect(CONSISTENCY_ACTIONABLE_CONFIDENCE).toBe(0.7);
    expect(CONSISTENCY_DEFAULT_MAX_PER_SUBJECT).toBe(400);
    expect(CONSISTENCY_DEFAULT_MAX_ADJUDICATIONS).toBe(60);
  });

  it("refuses a request without explicit opt-in consent", () => {
    expect(() =>
      parseConsistencyReviewRequest({
        consistencyConsent: false,
        document: { revision: "r1", text: "Hello.", sections: [] },
      }),
    ).toThrow();
    expect(() =>
      parseConsistencyReviewRequest({
        document: { revision: "r1", text: "Hello.", sections: [] },
      }),
    ).toThrow();
    expect(CONSISTENCY_CONSENT_ERROR).toMatch(/own consent/);
  });

  it("parses a consented request with defaults", () => {
    const request = parseConsistencyReviewRequest({
      consistencyConsent: true,
      document: { revision: "r1", text: "Hello.", sections: [] },
    });
    expect(request.checks).toEqual([...CONSISTENCY_CHECK_IDS]);
    expect(request.maxPerSubject).toBe(CONSISTENCY_DEFAULT_MAX_PER_SUBJECT);
    expect(request.maxAdjudications).toBe(CONSISTENCY_DEFAULT_MAX_ADJUDICATIONS);
    expect(request.allowUnredacted).toBe(false);
    expect(ConsistencyReviewRequestSchema.parse(request)).toEqual(request);
  });

  it("rejects an unknown check id", () => {
    expect(() =>
      parseConsistencyReviewRequest({
        consistencyConsent: true,
        document: { revision: "r1", text: "Hello.", sections: [] },
        checks: ["C99"],
      }),
    ).toThrow();
  });

  it("parses adjudications and verdicts", () => {
    expect(
      ConsistencyAdjudicationSchema.parse({
        verdict: "contradiction",
        reason: "The figures differ.",
        wrongSide: "left",
      }).verdict,
    ).toBe("contradiction");
    expect(() => ConsistencyAdjudicationSchema.parse({ verdict: "maybe", reason: "x" })).toThrow();
  });

  it("parses coverage, issues, reports, and progress", () => {
    const coverage = ConsistencyCoverageSchema.parse({
      complete: false,
      statementsConsidered: 10,
      statementsTotal: 10,
      comparisonsMade: 0,
      blockOverflowSkipped: 5,
      adjudicationsUsed: 0,
      adjudicationsAvailable: 60,
      perCheck: {},
      limitations: ["skeleton"],
      modelAdjudicated: 0,
    });
    expect(coverage.complete).toBe(false);
    const issue = ConsistencyIssueSchema.parse({
      checkId: "C1",
      fingerprint: "C1:a|b",
      title: "Terminology drift",
      detail: "Same term, two ways.",
      severity: "warning",
      confidence: 0.9,
      actionable: true,
      nodeIds: ["s-0", "s-1"],
      evidence: { left: "A", right: "B", sectionLeft: "", sectionRight: "" },
    });
    expect(issue.verdict).toBeUndefined();
    const report = ConsistencyReportSchema.parse({
      revision: "r1",
      issues: [issue],
      coverage,
      usedModel: false,
      startedAt: "2026-10-06T00:00:00.000Z",
      finishedAt: "2026-10-06T00:00:01.000Z",
    });
    expect(report.issues).toHaveLength(1);
    const progress = ConsistencyProgressSchema.parse({
      phase: "done",
      fraction: 1,
      message: "Done.",
    });
    expect(progress.phase).toBe("done");
  });

  it("parses the full claim schema with all facets", () => {
    const claim = ExpertReportClaimSchema.parse({
      id: "claim-1",
      reviewSessionId: "session-1",
      claimClass: "FACT_ASSERTION",
      predicate: { text: "completion slipped" },
      speaker: { id: "p1", name: "Contractor" },
      polarity: "positive",
      delay: { durationText: "six weeks", durationDays: 42 },
      scenario: { type: "primary" },
      evidence: {
        documentId: "doc-1",
        paragraphId: "p-1",
        startOffset: 0,
        endOffset: 10,
        exactText: "completion ",
        evidenceHash: "deadbeef",
      },
      extraction: {
        modelId: "m1",
        pass: "local",
        batchId: "b1",
        extractedAt: "2026-10-06T00:00:00.000Z",
      },
    });
    expect(claim.claimClass).toBe("FACT_ASSERTION");
    expect(claim.delay?.durationDays).toBe(42);
    expect(claim.adoptionStatus).toBe("unknown");
    expect(claim.scenario?.type).toBe("primary");
    expect(() => ExpertReportClaimSchema.parse({ ...claim, claimClass: "NOPE" })).toThrow();
  });

  it("parses the evidence registry with quarantine", () => {
    const registry = EvidenceRegistrySchema.parse({
      anchors: {
        "ev-1": {
          documentId: "doc-1",
          paragraphId: "p-1",
          startOffset: 0,
          endOffset: 10,
          exactText: "completion ",
          evidenceHash: "deadbeef",
        },
      },
      quarantined: [{ claimId: "claim-9", reason: "hash mismatch" }],
    });
    expect(registry.quarantined).toHaveLength(1);
  });

  it("parses every decision subject kind", () => {
    expect(DecisionSubjectSchema.parse({ kind: "entity", name: "Acme" }).kind).toBe("entity");
    expect(DecisionSubjectSchema.parse({ kind: "event", description: "handover" }).kind).toBe(
      "event",
    );
    expect(DecisionSubjectSchema.parse({ kind: "programme", identifier: "P1" }).kind).toBe(
      "programme",
    );
    expect(DecisionSubjectSchema.parse({ kind: "quantum", measure: "revenue" }).kind).toBe(
      "quantum",
    );
    expect(DecisionSubjectSchema.parse({ kind: "reference", citation: "[3]" }).kind).toBe(
      "reference",
    );
    expect(DecisionSubjectSchema.parse({ kind: "section", heading: "Summary" }).kind).toBe(
      "section",
    );
    expect(DecisionSubjectSchema.parse({ kind: "term", term: "handover" }).kind).toBe("term");
    expect(DecisionSubjectSchema.parse({ kind: "unknown", reason: "x" }).kind).toBe("unknown");
    expect(() => DecisionSubjectSchema.parse({ kind: "nope" })).toThrow();
  });

  it("parses D-outcomes, evaluation vectors, and confidence profiles", () => {
    expect(DOutcomeSchema.parse("D-CONFLICT")).toBe("D-CONFLICT");
    expect(() => DOutcomeSchema.parse("D-MAYBE")).toThrow();
    const vector = EvaluationVectorSchema.parse({ sameSubject: true, valuesAgree: false });
    expect(vector.valuesAgree).toBe(false);
    const profile = ConfidenceProfileSchema.parse({
      point: 0.72,
      lower: 0.6,
      upper: 0.84,
      calibrationVersion: "v1",
      reviewThreshold: 0.5,
      presentationThreshold: 0.7,
    });
    expect(profile.lower).toBeLessThan(profile.point);
    expect(profile.point).toBeLessThan(profile.upper);
  });

  it("parses decision questions and plans", () => {
    const binary = DecisionQuestionSchema.parse({
      kind: "binary",
      id: "q1",
      prompt: "Same period?",
      subjectId: "s-0",
    });
    expect(binary.kind).toBe("binary");
    const plan = DecisionPlanSchema.parse({
      revision: "r1",
      questions: [binary],
      budget: { maxQuestions: 60, maxExpansions: 1 },
    });
    expect(plan.questions).toHaveLength(1);
    expect(plan.allowUnredacted).toBe(false);
  });
});
