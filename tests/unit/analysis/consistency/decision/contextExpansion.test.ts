import { describe, expect, it } from "vitest";
import { expandContext } from "@/analysis/consistency/decision/contextExpansion";
import type { ContextRequest } from "@/analysis/consistency/decision/contextExpansion";
import type { ConsistencyIndices } from "@/analysis/consistency/indices/buildIndices";
import type { NormalisedClaim } from "@/analysis/consistency/normalisation";
import type { ConsistencyCandidate, ExpertReportClaim } from "@/analysis/consistency/contracts";
import { claim } from "../../../../fixtures/consistencyClaims";

function normalisedClaim(overrides: Partial<ExpertReportClaim> = {}): NormalisedClaim {
  const c = claim(overrides);
  return {
    claim: c,
    values: c.values.map((v) => ({
      ...v,
      normalized: v.normalized ?? Number(v.raw.replace(/[,\s]/g, "")),
    })),
    dates: [],
    durationDays: null,
  };
}

function buildIndices(claims: readonly NormalisedClaim[]): ConsistencyIndices {
  return {
    entities: { entityIds: [], claimsFor: () => [] },
    events: { eventIds: [], claimsFor: () => [] },
    temporal: { dateKeys: [], claimsFor: () => [] },
    quantities: { quantityKeys: [], claimsFor: () => [] },
    references: { citations: [], claimsFor: () => [] },
    sections: { sections: [], claimsFor: () => [] },
    programmes: { programmeIds: [], claimsFor: () => [] },
    terminology: { terms: [], claimsFor: () => [] },
    claims: { claimIds: claims.map((c) => c.claim.id), byId: () => null },
  };
}

function candidate(claimIds: readonly string[]): ConsistencyCandidate {
  return {
    id: "cand-1",
    checkId: "C2",
    subject: { kind: "unknown", reason: "fixture" },
    fingerprint: "fixture-fingerprint",
    claimIds: [...claimIds],
    retrieval: {
      reasonCodes: [],
      sharedEntityIds: [],
      sharedEventIds: [],
      sharedProgrammeIds: [],
      sharedMetricIds: [],
    },
    evidenceIds: [],
    state: "pending",
  };
}

describe("R5 decision: contextExpansion", () => {
  const claims = [
    normalisedClaim({ id: "claim-1", values: [{ raw: "10", normalized: 10, unit: "days" }] }),
    normalisedClaim({ id: "claim-2", values: [{ raw: "15", normalized: 15, unit: "days" }] }),
  ];
  const indices = buildIndices(claims);
  const candidates = [candidate(["claim-1", "claim-2"])];
  const documentText = "Claim 1 says 10 days. Claim 2 says 15 days.";

  it("returns empty array for empty requests", () => {
    const result = expandContext([], indices, claims, candidates, documentText);
    expect(result).toEqual([]);
  });

  it("expands CTX-SURROUNDING-PARAGRAPHS", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-SURROUNDING-PARAGRAPHS", candidateId: "cand-1", parameters: {} },
    ];
    const result = expandContext(requests, indices, claims, candidates, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-SURROUNDING-PARAGRAPHS");
    expect(result[0]?.content).toBeTruthy();
  });

  it("expands CTX-EVENT-HISTORY", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-EVENT-HISTORY", candidateId: "cand-1", parameters: { eventId: "event-1" } },
    ];
    const result = expandContext(requests, indices, claims, candidates, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-EVENT-HISTORY");
  });

  it("expands CTX-PROGRAMME-HISTORY", () => {
    const requests: readonly ContextRequest[] = [
      {
        type: "CTX-PROGRAMME-HISTORY",
        candidateId: "cand-1",
        parameters: { programmeId: "prog-1" },
      },
    ];
    const result = expandContext(requests, indices, claims, candidates, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-PROGRAMME-HISTORY");
  });

  it("expands CTX-TERM-DEFINITION", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-TERM-DEFINITION", candidateId: "cand-1", parameters: { term: "delay" } },
    ];
    const result = expandContext(requests, indices, claims, candidates, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-TERM-DEFINITION");
  });

  it("expands CTX-RELATED-CLAIMS", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-RELATED-CLAIMS", candidateId: "cand-1", parameters: {} },
    ];
    const result = expandContext(requests, indices, claims, candidates, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-RELATED-CLAIMS");
  });

  it("expands CTX-VALUATION-BASIS", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-VALUATION-BASIS", candidateId: "cand-1", parameters: {} },
    ];
    const result = expandContext(requests, indices, claims, candidates, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-VALUATION-BASIS");
  });

  it("expands CTX-MEASUREMENT-BASIS", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-MEASUREMENT-BASIS", candidateId: "cand-1", parameters: {} },
    ];
    const result = expandContext(requests, indices, claims, candidates, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-MEASUREMENT-BASIS");
  });

  it("expands CTX-REFERENCE-CONTENT", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-REFERENCE-CONTENT", candidateId: "cand-1", parameters: { reference: "ref-1" } },
    ];
    const result = expandContext(requests, indices, claims, candidates, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-REFERENCE-CONTENT");
  });

  it("expands CTX-SECTION-SUMMARY", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-SECTION-SUMMARY", candidateId: "cand-1", parameters: { section: "Section 1" } },
    ];
    const result = expandContext(requests, indices, claims, candidates, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-SECTION-SUMMARY");
  });

  it("handles multiple context requests", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-SURROUNDING-PARAGRAPHS", candidateId: "cand-1", parameters: {} },
      { type: "CTX-EVENT-HISTORY", candidateId: "cand-1", parameters: { eventId: "event-1" } },
      { type: "CTX-TERM-DEFINITION", candidateId: "cand-1", parameters: { term: "delay" } },
    ];
    const result = expandContext(requests, indices, claims, candidates, documentText);
    expect(result.length).toBe(3);
    const types = result.map((r) => r.request.type);
    expect(types).toContain("CTX-SURROUNDING-PARAGRAPHS");
    expect(types).toContain("CTX-EVENT-HISTORY");
    expect(types).toContain("CTX-TERM-DEFINITION");
  });

  it("returns content for valid context type", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-SURROUNDING-PARAGRAPHS", candidateId: "cand-1", parameters: {} },
    ];
    const result = expandContext(requests, indices, claims, candidates, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-SURROUNDING-PARAGRAPHS");
    expect(result[0]?.content).toBeDefined();
  });

  it("each result has required fields", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-SURROUNDING-PARAGRAPHS", candidateId: "cand-1", parameters: {} },
    ];
    const result = expandContext(requests, indices, claims, candidates, documentText);
    expect(result[0]?.request.type).toBeTruthy();
    expect(result[0]?.content).toBeDefined();
    expect(result[0]?.source).toBeDefined();
  });

  it("resolves a candidate's claims rather than treating the candidate id as a claim id", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-RELATED-CLAIMS", candidateId: "cand-1", parameters: {} },
    ];
    const result = expandContext(requests, indices, claims, candidates, documentText);
    expect(result[0]?.content).not.toBe("Candidate not found");
  });

  it("reports an unknown candidate rather than a missing claim", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-VALUATION-BASIS", candidateId: "cand-missing", parameters: {} },
    ];
    const result = expandContext(requests, indices, claims, candidates, documentText);
    expect(result[0]?.content).toBe("Candidate not found");
  });
});
