import { describe, expect, it } from "vitest";
import {
  CONSISTENCY_STORE_TTL_DAYS,
  CONSISTENCY_STORE_TTL_MS,
  ConsistencyAuditRecordSchema,
  buildAuditRecord,
  buildProvenance,
  evidenceStillValid,
  isExpired,
} from "../../../../../src/analysis/consistency/persistence/audit";
import type { ConsistencyReport } from "../../../../../src/analysis/consistency/contracts";

function report(overrides: Partial<ConsistencyReport> = {}): ConsistencyReport {
  return {
    revision: "r1",
    issues: [],
    coverage: {
      complete: true,
      statementsConsidered: 2,
      statementsTotal: 2,
      comparisonsMade: 1,
      blockOverflowSkipped: 0,
      adjudicationsUsed: 0,
      adjudicationsAvailable: 60,
      perCheck: {},
      limitations: [],
      modelAdjudicated: 0,
      quarantinedClaims: 0,
      deterministicResolved: 0,
      decisionAdjudicated: 0,
      unresolved: 0,
      gated: 0,
      reviewBandSuppressed: 0,
      budgetExceeded: 0,
    },
    usedModel: false,
    startedAt: "2026-10-06T00:00:00.000Z",
    finishedAt: "2026-10-06T00:00:01.000Z",
    ...overrides,
  };
}

function provenanceInput(overrides: Record<string, string> = {}) {
  return {
    documentFingerprint: "fp-abc",
    claimGraphSchemaVersion: "1.0",
    extractionPromptVersion: "1.0",
    generalModel: "gpt-4",
    decisionProvider: "system_one",
    decisionModel: "gpt-4",
    questionSetVersion: "1.0",
    confidenceProfileVersion: "1.0",
    createdAt: "2026-10-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("audit", () => {
  describe("TTL constants", () => {
    it("sets a seven-day TTL", () => {
      expect(CONSISTENCY_STORE_TTL_DAYS).toBe(7);
      expect(CONSISTENCY_STORE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe("buildProvenance", () => {
    it("derives expiresAt from createdAt plus the TTL", () => {
      const provenance = buildProvenance(provenanceInput());
      const created = Date.parse(provenance.createdAt);
      const expires = Date.parse(provenance.expiresAt);
      expect(expires - created).toBe(CONSISTENCY_STORE_TTL_MS);
    });

    it("passes through an unparseable createdAt as expiresAt", () => {
      const provenance = buildProvenance(provenanceInput({ createdAt: "not-a-date" }));
      expect(provenance.expiresAt).toBe("not-a-date");
    });

    it("carries every version and identity field", () => {
      const provenance = buildProvenance(provenanceInput());
      expect(provenance.documentFingerprint).toBe("fp-abc");
      expect(provenance.generalModel).toBe("gpt-4");
      expect(provenance.decisionProvider).toBe("system_one");
      expect(provenance.questionSetVersion).toBe("1.0");
    });
  });

  describe("buildAuditRecord", () => {
    it("sets the store version and revision from the report", () => {
      const record = buildAuditRecord(report(), buildProvenance(provenanceInput()), ["hash-1"]);
      expect(record.version).toBe(1);
      expect(record.revision).toBe("r1");
      expect(record.evidenceHashes).toEqual(["hash-1"]);
    });

    it("carries coverage and issues from the report", () => {
      const record = buildAuditRecord(report(), buildProvenance(provenanceInput()), []);
      expect(record.coverage.complete).toBe(true);
      expect(record.issues).toEqual([]);
    });

    it("parses through the schema", () => {
      const record = buildAuditRecord(report(), buildProvenance(provenanceInput()), ["h1", "h2"]);
      expect(() => ConsistencyAuditRecordSchema.parse(record)).not.toThrow();
    });
  });

  describe("isExpired", () => {
    it("returns false for a record written now", () => {
      const now = "2026-10-06T12:00:00.000Z";
      expect(isExpired(now, now)).toBe(false);
    });

    it("returns false for a record written within the TTL", () => {
      const updated = "2026-10-06T00:00:00.000Z";
      const now = "2026-10-06T03:00:00.000Z";
      expect(isExpired(updated, now)).toBe(false);
    });

    it("returns true for a record past the TTL", () => {
      const updated = "2026-10-01T00:00:00.000Z";
      const now = "2026-10-09T00:00:00.000Z";
      expect(isExpired(updated, now)).toBe(true);
    });

    it("treats an unparseable updatedAt as expired", () => {
      expect(isExpired("garbage", "2026-10-06T00:00:00.000Z")).toBe(true);
    });

    it("treats an unparseable now as expired", () => {
      expect(isExpired("2026-10-06T00:00:00.000Z", "garbage")).toBe(true);
    });
  });

  describe("evidenceStillValid", () => {
    it("returns true when every stored hash is present", () => {
      expect(evidenceStillValid(["a", "b"], ["a", "b", "c"])).toBe(true);
    });

    it("returns false when a stored hash is missing", () => {
      expect(evidenceStillValid(["a", "b"], ["a"])).toBe(false);
    });

    it("returns true for an empty stored set", () => {
      expect(evidenceStillValid([], ["a"])).toBe(true);
    });
  });
});
