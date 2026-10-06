import { describe, expect, it } from "vitest";
import { hashText } from "../../../../../src/shared/utils/text";
import {
  canonicalAnchorId,
  resolveSecondaryCitations,
  validateEvidence,
} from "../../../../../src/analysis/consistency/extraction";
import { EvidenceRegistrySchema } from "../../../../../src/analysis/consistency/contracts";
import {
  FIXTURE_DOCUMENT_ID,
  FIXTURE_TEXT,
  anchorFor,
  claim,
  attributionClaim,
  delayClaim,
  definitionClaim,
  exceptionScopeClaim,
  quantumClaim,
  referenceClaim,
  scenarioClaim,
  universalScopeClaim,
} from "../../../../fixtures/consistencyClaims";

/**
 * R1 validator tests: the validator proves a proposed claim's
 * evidence against the document text, quarantines what it cannot
 * prove, and assigns canonical ids only to what survives.
 */
describe("the evidence validator", () => {
  it("accepts a claim whose evidence resolves, and assigns a canonical id", () => {
    const result = validateEvidence({
      documentId: FIXTURE_DOCUMENT_ID,
      text: FIXTURE_TEXT,
      claims: [delayClaim],
    });
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.id).toBe("claim-1");
    expect(result.registry.quarantined).toHaveLength(0);
    expect(result.registry.anchors[canonicalAnchorId(delayClaim.evidence)]).toBeDefined();
  });

  it("accepts every R1 fixture case: attribution, scenario, delay, quantum, definition, reference, scope", () => {
    const fixtures = [
      attributionClaim,
      scenarioClaim,
      delayClaim,
      quantumClaim,
      definitionClaim,
      referenceClaim,
      universalScopeClaim,
      exceptionScopeClaim,
    ];
    const result = validateEvidence({
      documentId: FIXTURE_DOCUMENT_ID,
      text: FIXTURE_TEXT,
      claims: fixtures,
    });
    expect(result.claims).toHaveLength(fixtures.length);
    expect(result.registry.quarantined).toHaveLength(0);
  });

  it("assigns canonical claim ids in document order", () => {
    const result = validateEvidence({
      documentId: FIXTURE_DOCUMENT_ID,
      text: FIXTURE_TEXT,
      claims: [delayClaim, quantumClaim, definitionClaim],
    });
    expect(result.claims.map((validated) => validated.id)).toEqual([
      "claim-1",
      "claim-2",
      "claim-3",
    ]);
  });

  it("derives a stable canonical anchor id from the anchor content", () => {
    const anchor = anchorFor("a six-week delay");
    expect(canonicalAnchorId(anchor)).toMatch(/^ev-/);
    expect(canonicalAnchorId(anchor)).toBe(canonicalAnchorId({ ...anchor }));
    expect(canonicalAnchorId(anchor)).not.toBe(canonicalAnchorId(anchorFor("six-week delay")));
  });

  it("gives every validated claim provenance: an anchor whose hash matches its text", () => {
    const result = validateEvidence({
      documentId: FIXTURE_DOCUMENT_ID,
      text: FIXTURE_TEXT,
      claims: [attributionClaim, scenarioClaim, delayClaim, quantumClaim],
    });
    expect(result.claims).toHaveLength(4);
    result.claims.forEach((validated) => {
      expect(hashText(validated.evidence.exactText)).toBe(validated.evidence.evidenceHash);
    });
  });

  it("keeps an undetermined adoption as unknown, never inferring one", () => {
    const result = validateEvidence({
      documentId: FIXTURE_DOCUMENT_ID,
      text: FIXTURE_TEXT,
      claims: [claim({ adoptionStatus: "unknown" })],
    });
    expect(result.claims[0]?.adoptionStatus).toBe("unknown");
  });

  it("quarantines a claim whose endOffset is beyond the document", () => {
    const corrupt = claim({
      evidence: {
        ...anchorFor("a six-week delay"),
        endOffset: FIXTURE_TEXT.length + 100,
      },
    });
    const result = validateEvidence({
      documentId: FIXTURE_DOCUMENT_ID,
      text: FIXTURE_TEXT,
      claims: [corrupt],
    });
    expect(result.claims).toHaveLength(0);
    expect(result.registry.quarantined).toHaveLength(1);
    expect(result.registry.quarantined[0]?.reason).toMatch(/beyond the document/);
  });

  it("quarantines a claim whose offsets do not match the cited text", () => {
    const corrupt = claim({
      evidence: { ...anchorFor("a six-week delay"), exactText: "a different text" },
    });
    const result = validateEvidence({
      documentId: FIXTURE_DOCUMENT_ID,
      text: FIXTURE_TEXT,
      claims: [corrupt],
    });
    expect(result.claims).toHaveLength(0);
    expect(result.registry.quarantined[0]?.reason).toMatch(/does not match exactText/);
  });

  it("quarantines a claim whose hash does not match the cited text", () => {
    const corrupt = claim({
      evidence: { ...anchorFor("a six-week delay"), evidenceHash: "not-the-hash" },
    });
    const result = validateEvidence({
      documentId: FIXTURE_DOCUMENT_ID,
      text: FIXTURE_TEXT,
      claims: [corrupt],
    });
    expect(result.claims).toHaveLength(0);
    expect(result.registry.quarantined[0]?.reason).toMatch(/evidenceHash does not match/);
  });

  it("quarantines a claim whose startOffset exceeds its endOffset", () => {
    const anchor = anchorFor("a six-week delay");
    const corrupt = claim({
      evidence: {
        ...anchor,
        startOffset: anchor.endOffset + 1,
        endOffset: anchor.endOffset,
      },
    });
    const result = validateEvidence({
      documentId: FIXTURE_DOCUMENT_ID,
      text: FIXTURE_TEXT,
      claims: [corrupt],
    });
    expect(result.claims).toHaveLength(0);
    expect(result.registry.quarantined[0]?.reason).toMatch(/startOffset exceeds/);
  });

  it("counts the quarantine, so a refused claim is never silent", () => {
    const bad = claim({
      evidence: { ...anchorFor("a six-week delay"), evidenceHash: "bad" },
    });
    const result = validateEvidence({
      documentId: FIXTURE_DOCUMENT_ID,
      text: FIXTURE_TEXT,
      claims: [delayClaim, bad],
    });
    expect(result.claims).toHaveLength(1);
    expect(result.registry.quarantined).toHaveLength(1);
  });

  it("keeps the provisional id of a quarantined claim for traceability", () => {
    const bad = claim({
      id: "provisional-42",
      evidence: { ...anchorFor("a six-week delay"), evidenceHash: "bad" },
    });
    const result = validateEvidence({
      documentId: FIXTURE_DOCUMENT_ID,
      text: FIXTURE_TEXT,
      claims: [bad],
    });
    expect(result.registry.quarantined[0]?.claimId).toBe("provisional-42");
  });

  it("registers one anchor entry for two claims citing the same span", () => {
    const first = claim({ id: "first" });
    const second = claim({ id: "second" });
    const result = validateEvidence({
      documentId: FIXTURE_DOCUMENT_ID,
      text: FIXTURE_TEXT,
      claims: [first, second],
    });
    expect(result.claims).toHaveLength(2);
    expect(Object.keys(result.registry.anchors)).toHaveLength(1);
  });

  describe("secondary citation resolution", () => {
    it("keeps a secondary citation that names a registered anchor", () => {
      const primary = claim({ id: "primary" });
      const result = validateEvidence({
        documentId: FIXTURE_DOCUMENT_ID,
        text: FIXTURE_TEXT,
        claims: [primary],
      });
      const anchorId = canonicalAnchorId(primary.evidence);
      const withCitation = resolveSecondaryCitations({
        ...result,
        claims: [{ ...result.claims[0]!, evidenceBasis: [{ anchorId }] }],
      });
      expect(withCitation.claims[0]?.evidenceBasis).toEqual([{ anchorId }]);
      expect(withCitation.registry.quarantined).toHaveLength(0);
    });

    it("quarantines a secondary citation that names an anchor not in the registry", () => {
      const primary = claim({ id: "primary" });
      const result = validateEvidence({
        documentId: FIXTURE_DOCUMENT_ID,
        text: FIXTURE_TEXT,
        claims: [primary],
      });
      const withCitation = resolveSecondaryCitations({
        ...result,
        claims: [
          {
            ...result.claims[0]!,
            evidenceBasis: [{ anchorId: "ev-does-not-exist" }],
          },
        ],
      });
      expect(withCitation.claims[0]?.evidenceBasis).toEqual([]);
      expect(withCitation.registry.quarantined).toHaveLength(1);
      expect(withCitation.registry.quarantined[0]?.claimId).toBe("claim-1");
      expect(withCitation.registry.quarantined[0]?.reason).toMatch(
        /ev-does-not-exist is not in the registry/,
      );
    });

    it("keeps the resolved citations and quarantines only the dangling ones", () => {
      const primary = claim({ id: "primary" });
      const result = validateEvidence({
        documentId: FIXTURE_DOCUMENT_ID,
        text: FIXTURE_TEXT,
        claims: [primary],
      });
      const goodId = canonicalAnchorId(primary.evidence);
      const withCitations = resolveSecondaryCitations({
        ...result,
        claims: [
          {
            ...result.claims[0]!,
            evidenceBasis: [{ anchorId: goodId }, { anchorId: "ev-missing" }],
          },
        ],
      });
      expect(withCitations.claims[0]?.evidenceBasis).toEqual([{ anchorId: goodId }]);
      expect(withCitations.registry.quarantined).toHaveLength(1);
    });

    it("is idempotent: a claim whose citations already resolve is left unchanged", () => {
      const primary = claim({ id: "primary" });
      const result = validateEvidence({
        documentId: FIXTURE_DOCUMENT_ID,
        text: FIXTURE_TEXT,
        claims: [primary],
      });
      const anchorId = canonicalAnchorId(primary.evidence);
      const once = resolveSecondaryCitations({
        ...result,
        claims: [{ ...result.claims[0]!, evidenceBasis: [{ anchorId }] }],
      });
      const twice = resolveSecondaryCitations(once);
      expect(twice).toEqual(once);
    });

    it("leaves a claim with no secondary citations untouched", () => {
      const primary = claim({ id: "primary" });
      const result = validateEvidence({
        documentId: FIXTURE_DOCUMENT_ID,
        text: FIXTURE_TEXT,
        claims: [primary],
      });
      const resolved = resolveSecondaryCitations(result);
      expect(resolved.claims[0]?.evidenceBasis).toEqual([]);
      expect(resolved.registry.quarantined).toHaveLength(0);
    });

    it("produces a registry that still parses", () => {
      const primary = claim({ id: "primary" });
      const result = validateEvidence({
        documentId: FIXTURE_DOCUMENT_ID,
        text: FIXTURE_TEXT,
        claims: [primary],
      });
      const resolved = resolveSecondaryCitations({
        ...result,
        claims: [
          {
            ...result.claims[0]!,
            evidenceBasis: [{ anchorId: "ev-missing" }],
          },
        ],
      });
      expect(() => EvidenceRegistrySchema.parse(resolved.registry)).not.toThrow();
    });
  });
});
