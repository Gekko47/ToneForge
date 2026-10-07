import { describe, expect, it } from "vitest";
import { expandContext } from "@/analysis/consistency/decision/contextExpansion";
import type { ContextRequest } from "@/analysis/consistency/decision/contextExpansion";
import type { ConsistencyIndices } from "@/analysis/consistency/indices/buildIndices";
import type { NormalisedClaim } from "@/analysis/consistency/normalisation";
import type { ExpertReportClaim } from "@/analysis/consistency/contracts";
import { claim } from "../../../../fixtures/consistencyClaims";

function normalisedClaim(overrides: Partial<NormalisedClaim> = {}): NormalisedClaim {
  const c = claim(overrides as Partial<ExpertReportClaim>);
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

describe("R5 decision: contextExpansion", () => {
  const claims = [
    normalisedClaim({ values: [{ raw: "10", normalized: 10, unit: "days" }] }),
    normalisedClaim({ values: [{ raw: "15", normalized: 15, unit: "days" }] }),
  ];
  const indices = buildIndices(claims);
  const documentText = "Claim 1 says 10 days. Claim 2 says 15 days.";

  it("returns empty array for empty requests", () => {
    const result = expandContext([], indices, claims, documentText);
    expect(result).toEqual([]);
  });

  it("expands CTX-SURROUNDING-PARAGRAPHS", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-SURROUNDING-PARAGRAPHS", candidateId: "claim-1", parameters: {} },
    ];
    const result = expandContext(requests, indices, claims, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-SURROUNDING-PARAGRAPHS");
    expect(result[0]?.content).toBeTruthy();
  });

  it("expands CTX-EVENT-HISTORY", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-EVENT-HISTORY", candidateId: "claim-1", parameters: { eventId: "event-1" } },
    ];
    const result = expandContext(requests, indices, claims, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-EVENT-HISTORY");
  });

  it("expands CTX-PROGRAMME-HISTORY", () => {
    const requests: readonly ContextRequest[] = [
      {
        type: "CTX-PROGRAMME-HISTORY",
        candidateId: "claim-1",
        parameters: { programmeId: "prog-1" },
      },
    ];
    const result = expandContext(requests, indices, claims, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-PROGRAMME-HISTORY");
  });

  it("expands CTX-TERM-DEFINITION", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-TERM-DEFINITION", candidateId: "claim-1", parameters: { term: "delay" } },
    ];
    const result = expandContext(requests, indices, claims, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-TERM-DEFINITION");
  });

  it("expands CTX-RELATED-CLAIMS", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-RELATED-CLAIMS", candidateId: "claim-1", parameters: {} },
    ];
    const result = expandContext(requests, indices, claims, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-RELATED-CLAIMS");
  });

  it("expands CTX-VALUATION-BASIS", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-VALUATION-BASIS", candidateId: "claim-1", parameters: {} },
    ];
    const result = expandContext(requests, indices, claims, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-VALUATION-BASIS");
  });

  it("expands CTX-MEASUREMENT-BASIS", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-MEASUREMENT-BASIS", candidateId: "claim-1", parameters: {} },
    ];
    const result = expandContext(requests, indices, claims, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-MEASUREMENT-BASIS");
  });

  it("expands CTX-REFERENCE-CONTENT", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-REFERENCE-CONTENT", candidateId: "claim-1", parameters: { reference: "ref-1" } },
    ];
    const result = expandContext(requests, indices, claims, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-REFERENCE-CONTENT");
  });

  it("expands CTX-SECTION-SUMMARY", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-SECTION-SUMMARY", candidateId: "claim-1", parameters: { section: "Section 1" } },
    ];
    const result = expandContext(requests, indices, claims, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-SECTION-SUMMARY");
  });

  it("handles multiple context requests", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-SURROUNDING-PARAGRAPHS", candidateId: "claim-1", parameters: {} },
      { type: "CTX-EVENT-HISTORY", candidateId: "claim-1", parameters: { eventId: "event-1" } },
      { type: "CTX-TERM-DEFINITION", candidateId: "claim-1", parameters: { term: "delay" } },
    ];
    const result = expandContext(requests, indices, claims, documentText);
    expect(result.length).toBe(3);
    const types = result.map((r) => r.request.type);
    expect(types).toContain("CTX-SURROUNDING-PARAGRAPHS");
    expect(types).toContain("CTX-EVENT-HISTORY");
    expect(types).toContain("CTX-TERM-DEFINITION");
  });

  it("returns content for valid context type", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-SURROUNDING-PARAGRAPHS", candidateId: "claim-1", parameters: {} },
    ];
    const result = expandContext(requests, indices, claims, documentText);
    expect(result.length).toBe(1);
    expect(result[0]?.request.type).toBe("CTX-SURROUNDING-PARAGRAPHS");
    expect(result[0]?.content).toBeDefined();
  });

  it("each result has required fields", () => {
    const requests: readonly ContextRequest[] = [
      { type: "CTX-SURROUNDING-PARAGRAPHS", candidateId: "claim-1", parameters: {} },
    ];
    const result = expandContext(requests, indices, claims, documentText);
    expect(result[0]?.request.type).toBeTruthy();
    expect(result[0]?.content).toBeDefined();
    expect(result[0]?.source).toBeDefined();
  });
});
