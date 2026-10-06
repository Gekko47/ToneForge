import type { z } from "zod";
import { hashText } from "../../src/shared/utils/text";
import {
  ExpertReportClaimSchema,
  type EvidenceAnchor,
  type ExpertReportClaim,
} from "../../src/analysis/consistency/contracts";

/**
 * Fixtures for the claim facets the engine must compare (R1
 * acceptance: attribution, scenario, delay, quantum, definition,
 * reference, scope).
 *
 * **Every party, figure, and date in this file is invented.**
 * There is no real engagement here, and none of it may be
 * replaced with real material: the corpus exists so the claim
 * schema and the evidence validator can be tested against the
 * shape of a construction expert report without putting anyone's
 * document into a repository.
 *
 * It is a fixture, not a test file, so Vitest does not collect
 * it and it is not part of the coverage measurement.
 */

/** The fixture document every claim anchors into. */
export const FIXTURE_DOCUMENT_ID = "doc-fixture";

export const FIXTURE_TEXT =
  "The contractor reported a six-week delay to the accepted baseline programme. The quantum is 1,250,000 USD nominal. Handover means the date the works are completed. All work is subject to the contract, except listed items. See clause 12.3.";

/**
 * An anchor citing a real span of the fixture document.
 *
 * The offsets are derived from the cited text, so the anchor
 * always resolves: the evidence validator accepts every anchor
 * this builder produces.
 */
export function anchorFor(cited: string, paragraphId = "p-1"): EvidenceAnchor {
  const start = FIXTURE_TEXT.indexOf(cited);
  if (start < 0) {
    throw new Error(`fixture text does not contain: ${cited}`);
  }
  const end = start + cited.length;
  return {
    documentId: FIXTURE_DOCUMENT_ID,
    sectionPath: ["Programme"],
    paragraphId,
    startOffset: start,
    endOffset: end,
    exactText: cited,
    evidenceHash: hashText(cited),
  };
}

/** The input shape of a claim: defaulted facets may be omitted. */
type ClaimInput = z.input<typeof ExpertReportClaimSchema>;

/** A valid claim with the minimum required fields, open to overrides. */
export function claim(overrides: Partial<ClaimInput> = {}): ExpertReportClaim {
  return ExpertReportClaimSchema.parse({
    id: "provisional",
    reviewSessionId: "session-fixture",
    claimClass: "FACT_ASSERTION",
    predicate: { text: "the contractor reported a delay" },
    speaker: { id: "party-contractor", name: "The Contractor" },
    adoptionStatus: "author_opinion",
    polarity: "positive",
    evidence: anchorFor("a six-week delay"),
    extraction: {
      modelId: "fixture-model",
      pass: "local",
      batchId: "batch-1",
      extractedAt: "2026-10-06T00:00:00.000Z",
    },
    ...overrides,
  });
}

/** Attribution: a reported party position, attributed to a party other than the speaker. */
export const attributionClaim: ExpertReportClaim = claim({
  claimClass: "REPORTED_FACT",
  adoptionStatus: "reported_party_position",
  attributedTo: {
    id: "party-employer",
    name: "The Employer",
    role: "reporting party",
  },
  predicate: { text: "the employer reported the delay" },
  evidence: anchorFor("The contractor reported"),
});

/** Scenario: a position stated under an alternative scenario, not the primary one. */
export const scenarioClaim: ExpertReportClaim = claim({
  claimClass: "SCENARIO",
  scenario: {
    type: "alternative",
    description: "the employer's alternative case",
    owner: { id: "party-employer", name: "The Employer" },
  },
  predicate: { text: "the delay under the alternative case" },
  evidence: anchorFor("six-week delay"),
});

/** Delay: a delay claim with its duration, basis, and programme basis. */
export const delayClaim: ExpertReportClaim = claim({
  claimClass: "FACT_ASSERTION",
  delay: {
    durationText: "six weeks",
    durationDays: 42,
    durationBasis: "calendar",
    analysisMethod: "time-impact",
    programmeBasis: "accepted baseline",
    criticality: "critical",
  },
  predicate: { text: "completion slipped by six weeks" },
  evidence: anchorFor("a six-week delay"),
});

/** Quantum: a sum with its currency, basis, and valuation method. */
export const quantumClaim: ExpertReportClaim = claim({
  claimClass: "VALUATION_POSITION",
  quantum: {
    amount: 1250000,
    currency: "USD",
    basis: "nominal",
    valuationMethod: "actual cost",
    headType: "prolongation",
  },
  values: [{ raw: "1,250,000 USD", normalized: 1250000, currency: "USD" }],
  predicate: { text: "the quantum is 1,250,000 USD nominal" },
  evidence: anchorFor("1,250,000 USD nominal"),
});

/** Definition: a definitional claim (C5), stating what a term means. */
export const definitionClaim: ExpertReportClaim = claim({
  claimClass: "QUALIFICATION",
  predicate: {
    text: "handover means the date the works are completed",
    kind: "definition",
  },
  evidence: anchorFor("Handover means the date the works are completed"),
});

/** Reference: a claim citing a contractual document. */
export const referenceClaim: ExpertReportClaim = claim({
  claimClass: "REFERENCE",
  documentRefIds: ["doc-contract"],
  predicate: { text: "see clause 12.3" },
  evidence: anchorFor("clause 12.3"),
});

/** Scope: a universal claim — it applies to all the work. */
export const universalScopeClaim: ExpertReportClaim = claim({
  claimClass: "CONTRACTUAL_REQUIREMENT",
  scope: { kind: "universal", description: "all work" },
  predicate: { text: "all work is subject to the contract" },
  evidence: anchorFor("All work is subject to the contract"),
});

/** Scope: an exception to the universal claim. */
export const exceptionScopeClaim: ExpertReportClaim = claim({
  claimClass: "CONTRACTUAL_REQUIREMENT",
  scope: { kind: "exception", description: "excepted items" },
  predicate: { text: "excepted items are not subject to the contract" },
  evidence: anchorFor("except listed items"),
});
