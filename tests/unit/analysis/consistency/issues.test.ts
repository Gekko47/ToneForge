import { describe, expect, it } from "vitest";
import { buildIssue, buildWhyConfidence } from "../../../../src/analysis/consistency/issues";
import type { IssueInput } from "../../../../src/analysis/consistency/issues";
import type {
  ConfidenceProfile,
  ConsistencyCandidate,
} from "../../../../src/analysis/consistency/contracts";
import type { NormalisedClaim } from "../../../../src/analysis/consistency/normalisation";

function confidence(overrides: Partial<ConfidenceProfile> = {}): ConfidenceProfile {
  return {
    point: 0.9,
    lower: 0.8,
    upper: 0.95,
    calibrationVersion: "consistency_decision-v1",
    reviewThreshold: 0.55,
    presentationThreshold: 0.7,
    ...overrides,
  };
}

function candidate(overrides: Partial<ConsistencyCandidate> = {}): ConsistencyCandidate {
  return {
    id: "cand-1",
    checkId: "C1",
    subject: { kind: "term", term: "Delay" },
    fingerprint: "C1:a|b",
    claimIds: ["s-0", "s-1"],
    retrieval: {
      reasonCodes: ["shared-term"],
      sharedEntityIds: [],
      sharedEventIds: [],
      sharedProgrammeIds: [],
      sharedMetricIds: [],
    },
    evidenceIds: [],
    state: "pending",
    ...overrides,
  };
}

function normalisedClaim(id: string, startOffset: number, endOffset: number): NormalisedClaim {
  return {
    claim: {
      id,
      reviewSessionId: "rs-1",
      claimClass: "FACT_ASSERTION",
      predicate: { text: "The delay is 42 days." },
      speaker: { id: "p1", name: "Expert" },
      polarity: "positive",
      adoptionStatus: "author_opinion",
      subjectIds: [],
      objectIds: [],
      workItemIds: [],
      eventIds: [],
      programmeIds: [],
      documentRefIds: [],
      temporal: {},
      values: [],
      scope: { kind: "unknown" },
      evidenceBasis: [],
      modality: "assertion",
      qualifiers: [],
      assertionStrength: "definitive",
      evidence: {
        documentId: "doc-1",
        sectionPath: ["Section 1"],
        paragraphId: "para-1",
        startOffset,
        endOffset,
        exactText: "The delay is 42 days.",
        evidenceHash: `hash-${id}`,
      },
      extraction: {
        modelId: "gpt-4",
        pass: "local",
        batchId: "batch-1",
        extractedAt: "2026-10-06T00:00:00.000Z",
      },
    },
    values: [],
    dates: [],
    durationDays: null,
  };
}

function issueInput(overrides: Partial<IssueInput> = {}): IssueInput {
  return {
    candidate: candidate(),
    checkId: "C1",
    claims: [normalisedClaim("s-0", 0, 22), normalisedClaim("s-1", 30, 52)],
    dOutcome: "D-CONFLICT",
    confidence: confidence(),
    deterministicAnswers: [{ question: "E-ENTITY-SAME", holds: true, reason: "shared entity" }],
    modelAnswers: [
      { question: "E-VALUE-INCOMPATIBLE", holds: true, reason: "values differ", confidence: 0.9 },
    ],
    reasonCodes: ["value-mismatch"],
    actionable: true,
    ...overrides,
  };
}

describe("issues", () => {
  describe("buildWhyConfidence", () => {
    it("orders deterministic answers before model answers", () => {
      const rows = buildWhyConfidence(
        [{ question: "E-ENTITY-SAME", holds: true, reason: "shared" }],
        [{ question: "E-VALUE-INCOMPATIBLE", holds: true, reason: "differs", confidence: 0.9 }],
      );
      expect(rows).toBeDefined();
      if (rows === undefined) throw new Error("expected rows");
      expect(rows[0]?.provenance).toBe("deterministic");
      expect(rows[1]?.provenance).toBe("system_one");
    });

    it("labels each row with the human-readable E-label", () => {
      const rows = buildWhyConfidence(
        [{ question: "E-ENTITY-SAME", holds: true, reason: "shared" }],
        [],
      );
      if (rows === undefined) throw new Error("expected rows");
      expect(rows[0]?.label).toBe("Same entity");
    });

    it("falls back to the raw question when no label exists", () => {
      const rows = buildWhyConfidence(
        [{ question: "E-UNKNOWN-QUESTION", holds: true, reason: "?" }],
        [],
      );
      if (rows === undefined) throw new Error("expected rows");
      expect(rows[0]?.label).toBe("E-UNKNOWN-QUESTION");
    });

    it("tags deterministic answers as proven or disproven", () => {
      const rows = buildWhyConfidence(
        [
          { question: "E-ENTITY-SAME", holds: true, reason: "shared" },
          { question: "E-SCOPE-SAME", holds: false, reason: "different scope" },
        ],
        [],
      );
      if (rows === undefined) throw new Error("expected rows");
      expect(rows[0]?.strength).toBe("Proven · deterministic");
      expect(rows[1]?.strength).toBe("Disproven · deterministic");
    });

    it("tags model answers with the confidence percentage", () => {
      const rows = buildWhyConfidence(
        [],
        [{ question: "E-VALUE-INCOMPATIBLE", holds: true, reason: "differs", confidence: 0.85 }],
      );
      if (rows === undefined) throw new Error("expected rows");
      expect(rows[0]?.strength).toBe("Holds · decision model (85%)");
    });

    it("returns undefined when there are no answers", () => {
      expect(buildWhyConfidence([], [])).toBeUndefined();
    });
  });

  describe("buildIssue", () => {
    it("returns null when the candidate has fewer than two locatable claims", () => {
      const input = issueInput({ claims: [normalisedClaim("s-0", 0, 22)] });
      expect(buildIssue(input)).toBeNull();
    });

    it("returns null when a claim id is not found", () => {
      const input = issueInput({
        candidate: candidate({ claimIds: ["s-0", "missing"] }),
        claims: [normalisedClaim("s-0", 0, 22)],
      });
      expect(buildIssue(input)).toBeNull();
    });

    it("builds an issue with the check title and detail", () => {
      const issue = buildIssue(issueInput());
      expect(issue).not.toBeNull();
      if (issue === null) throw new Error("expected issue");
      expect(issue.checkId).toBe("C1");
      expect(issue.title).toBe("Terminology drift");
      expect(issue.detail).toContain("Is the same term used two ways?");
      expect(issue.detail).toContain("Reason: value-mismatch.");
      expect(issue.detail).toContain("Outcome: D-CONFLICT.");
    });

    it("sets verdict to contradiction for D-CONFLICT", () => {
      const issue = buildIssue(issueInput({ dOutcome: "D-CONFLICT" }));
      if (issue === null) throw new Error("expected issue");
      expect(issue.verdict).toBe("contradiction");
    });

    it("sets verdict to notAConflict for D-CONSISTENT", () => {
      const issue = buildIssue(issueInput({ dOutcome: "D-CONSISTENT" }));
      if (issue === null) throw new Error("expected issue");
      expect(issue.verdict).toBe("notAConflict");
    });

    it("sets verdict to unclear for D-AMBIGUOUS", () => {
      const issue = buildIssue(issueInput({ dOutcome: "D-AMBIGUOUS" }));
      if (issue === null) throw new Error("expected issue");
      expect(issue.verdict).toBe("unclear");
    });

    it("carries both claim ids and their ranges", () => {
      const issue = buildIssue(issueInput());
      if (issue === null) throw new Error("expected issue");
      expect(issue.nodeIds).toEqual(["s-0", "s-1"]);
      expect(issue.ranges?.left).toEqual({ start: 0, end: 22 });
      expect(issue.ranges?.right).toEqual({ start: 30, end: 52 });
    });

    it("carries evidence text from both claims", () => {
      const issue = buildIssue(issueInput());
      if (issue === null) throw new Error("expected issue");
      expect(issue.evidence.left).toBe("The delay is 42 days.");
      expect(issue.evidence.right).toBe("The delay is 42 days.");
    });

    it("includes why-confidence when answers exist", () => {
      const issue = buildIssue(issueInput());
      if (issue === null) throw new Error("expected issue");
      expect(issue.whyConfidence).toBeDefined();
      expect(issue.whyConfidence?.length).toBe(2);
    });

    it("omits why-confidence when there are no answers", () => {
      const issue = buildIssue(issueInput({ deterministicAnswers: [], modelAnswers: [] }));
      if (issue === null) throw new Error("expected issue");
      expect(issue.whyConfidence).toBeUndefined();
    });

    it("sets actionable from the input flag", () => {
      const issue = buildIssue(issueInput({ actionable: false }));
      if (issue === null) throw new Error("expected issue");
      expect(issue.actionable).toBe(false);
    });

    it("sets confidence from the profile point", () => {
      const issue = buildIssue(issueInput({ confidence: confidence({ point: 0.72 }) }));
      if (issue === null) throw new Error("expected issue");
      expect(issue.confidence).toBe(0.72);
    });
  });
});
