import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { resolveCanonicalClaims } from "../../../../../src/analysis/consistency/extraction/globalResolver";
import { validateEvidence } from "../../../../../src/analysis/consistency/extraction/evidenceValidator";
import {
  ExpertReportClaimSchema,
  type ExpertReportClaim,
} from "../../../../../src/analysis/consistency/contracts";
import { hashText } from "../../../../../src/shared/utils/text";

/** The input shape of a claim: defaulted facets may be omitted. */
type ClaimInput = z.input<typeof ExpertReportClaimSchema>;

/**
 * R2 Pass B tests: claims are ordered by their
 * position in the document, duplicates collapse,
 * and the survivors receive canonical ids from
 * the evidence validator — stable for the same
 * input, because ToneForge owns the ids.
 */

const TEXT = "The contractor reported a six-week delay. The quantum is 1,250,000 USD.";

function claimOn(cited: string, overrides: Partial<ClaimInput> = {}): ExpertReportClaim {
  const start = TEXT.indexOf(cited);
  if (start < 0) {
    throw new Error(`fixture text does not contain: ${cited}`);
  }
  const exactText = TEXT.slice(start, start + cited.length);
  return ExpertReportClaimSchema.parse({
    id: "provisional",
    reviewSessionId: "session-1",
    claimClass: "FACT_ASSERTION",
    predicate: { text: "a claim" },
    speaker: { id: "party-contractor", name: "The Contractor" },
    adoptionStatus: "author_opinion",
    polarity: "positive",
    evidence: {
      documentId: "doc-1",
      sectionPath: [],
      paragraphId: "p-1-0",
      startOffset: start,
      endOffset: start + cited.length,
      exactText,
      evidenceHash: hashText(exactText),
    },
    extraction: {
      modelId: "mock",
      pass: "local",
      batchId: "batch-1",
      extractedAt: "2026-10-06T00:00:00.000Z",
    },
    ...overrides,
  });
}

function resolve(claims: ExpertReportClaim[]) {
  return resolveCanonicalClaims({
    documentId: "doc-1",
    text: TEXT,
    claims,
  });
}

describe("Pass B global canonical resolution", () => {
  it("assigns canonical ids in document order", () => {
    const first = claimOn("a six-week delay", {
      predicate: { text: "the delay" },
    });
    const second = claimOn("1,250,000 USD", {
      predicate: { text: "the quantum" },
    });
    const result = resolve([second, first]);
    expect(result.claims.map((claim) => claim.id)).toEqual(["claim-1", "claim-2"]);
    expect(result.claims[0]?.predicate.text).toBe("the delay");
    expect(result.claims[1]?.predicate.text).toBe("the quantum");
  });

  it("collapses a duplicate claim extracted twice", () => {
    const claim = claimOn("a six-week delay");
    const result = resolve([claim, { ...claim }]);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.id).toBe("claim-1");
  });

  it("keeps distinct claims that share a predicate but cite different spans", () => {
    const delay = claimOn("a six-week delay", {
      predicate: { text: "the delay" },
    });
    const quantum = claimOn("1,250,000 USD", {
      predicate: { text: "the delay" },
    });
    const result = resolve([delay, quantum]);
    expect(result.claims).toHaveLength(2);
  });

  it("keeps claims by different speakers that cite the same span", () => {
    const contractor = claimOn("a six-week delay");
    const employer = claimOn("a six-week delay", {
      speaker: { id: "party-employer", name: "The Employer" },
    });
    const result = resolve([contractor, employer]);
    expect(result.claims).toHaveLength(2);
  });

  it("produces canonical ids that are stable for the same input", () => {
    const claims = [claimOn("a six-week delay"), claimOn("1,250,000 USD")];
    const first = resolve(claims);
    const second = resolve(claims);
    expect(second.claims.map((claim) => claim.id)).toEqual(first.claims.map((claim) => claim.id));
    expect(second.registry).toEqual(first.registry);
  });

  it("quarantines a claim whose evidence does not resolve, keeping its provisional id", () => {
    const bad = claimOn("a six-week delay", {
      evidence: {
        documentId: "doc-1",
        sectionPath: [],
        paragraphId: "p-1-0",
        startOffset: 0,
        endOffset: 5,
        exactText: "nope",
        evidenceHash: hashText("nope"),
      },
    });
    const good = claimOn("1,250,000 USD");
    const result = resolve([bad, good]);
    expect(result.claims.map((claim) => claim.id)).toEqual(["claim-1"]);
    expect(result.registry.quarantined).toHaveLength(1);
    expect(result.registry.quarantined[0]?.claimId).toBe("provisional");
  });

  it("matches the evidence validator on distinct, ordered claims", () => {
    const claims = [claimOn("a six-week delay"), claimOn("1,250,000 USD")];
    const viaResolver = resolve(claims);
    const viaValidator = validateEvidence({
      documentId: "doc-1",
      text: TEXT,
      claims,
    });
    expect(viaResolver).toEqual(viaValidator);
  });
});
