import { hashText } from "../../../shared/utils/text";
import {
  EvidenceRegistrySchema,
  type EvidenceAnchor,
  type EvidenceBasis,
  type EvidenceRegistry,
  type ExpertReportClaim,
} from "../contracts";

/**
 * The evidence validator (original §6; ToneForge-owned per §4).
 *
 * The General LLM proposes claims with evidence anchors; this
 * validator proves each anchor against the document text before
 * the claim may enter the pipeline. A claim whose evidence is
 * unresolved — offsets that do not bound the cited text, text
 * that does not match the offsets, a hash that does not match
 * the text — is quarantined, never compared, and the quarantine
 * is counted so the report says what it refused.
 *
 * Canonical ids are assigned only after validation: a claim that
 * survives receives a canonical claim id and its anchor a
 * canonical anchor id, both stable within the session; a claim
 * that does not keeps only its provisional id, in the quarantine
 * record, for traceability.
 */

/** What the validator needs: the document text and the proposed claims. */
export interface EvidenceValidationInput {
  documentId: string;
  text: string;
  claims: ExpertReportClaim[];
}

/** What the validator produces: validated claims and the evidence registry. */
export interface EvidenceValidationResult {
  claims: ExpertReportClaim[];
  registry: EvidenceRegistry;
}

/**
 * The canonical anchor id, derived from the anchor's content so
 * the same span always maps to the same entry within a session.
 */
export function canonicalAnchorId(anchor: EvidenceAnchor): string {
  return `ev-${hashText(
    `${anchor.documentId}|${anchor.paragraphId}|${anchor.startOffset}|${anchor.endOffset}`,
  )}`;
}

/**
 * Resolve the secondary citations on every validated claim against
 * the registry.
 *
 * A claim's primary anchor is proven by `validateEvidence`; the
 * `evidenceBasis` facet is the list of further anchors the claim
 * leans on. Those are citations, not assertions: they name an
 * anchor id, and if that id is not in the registry the citation
 * is dangling. This rewrites each claim's `evidenceBasis` to the
 * subset that actually resolved, and records the rest as
 * quarantined with the claim's provisional id, so a bad
 * secondary citation is visible in the report rather than
 * silently dropped.
 *
 * It is idempotent: passing claims whose `evidenceBasis` is
 * already a subset of the registry leaves them unchanged.
 */
export function resolveSecondaryCitations(
  result: EvidenceValidationResult,
): EvidenceValidationResult {
  const anchorIds = new Set(Object.keys(result.registry.anchors));
  const quarantined = [...result.registry.quarantined];
  const claims = result.claims.map((claim) => {
    if (claim.evidenceBasis.length === 0) {
      return claim;
    }
    const resolved: EvidenceBasis[] = [];
    for (const basis of claim.evidenceBasis) {
      if (anchorIds.has(basis.anchorId)) {
        resolved.push(basis);
      } else {
        quarantined.push({
          claimId: claim.id,
          reason: `secondary evidence citation ${basis.anchorId} is not in the registry`,
        });
      }
    }
    return resolved.length === claim.evidenceBasis.length
      ? claim
      : { ...claim, evidenceBasis: resolved };
  });

  return {
    claims,
    registry: EvidenceRegistrySchema.parse({
      anchors: result.registry.anchors,
      quarantined,
    }),
  };
}

/**
 * Validate every claim's evidence against the document text.
 *
 * Claims are processed in document order; each validated claim
 * receives the next canonical claim id, and its anchor is
 * registered under its canonical anchor id. Quarantined claims
 * are excluded from the returned claims and recorded with the
 * reason they were refused.
 */
export function validateEvidence(input: EvidenceValidationInput): EvidenceValidationResult {
  const anchors = new Map<string, EvidenceAnchor>();
  const quarantined: { claimId: string; reason: string }[] = [];
  const claims: ExpertReportClaim[] = [];
  let sequence = 0;

  input.claims.forEach((claim) => {
    const failure = describeAnchorFailure(input.text, claim.evidence);
    if (failure !== null) {
      quarantined.push({ claimId: claim.id, reason: failure });
      return;
    }
    sequence += 1;
    anchors.set(canonicalAnchorId(claim.evidence), claim.evidence);
    claims.push({ ...claim, id: `claim-${sequence}` });
  });

  return {
    claims,
    registry: EvidenceRegistrySchema.parse({
      anchors: Object.fromEntries(anchors),
      quarantined,
    }),
  };
}

/**
 * Why an anchor is unresolved, or null when it holds.
 *
 * Four checks, in order: the offsets must bound a range, the
 * range must lie inside the document, the text at the range must
 * be the cited text, and the cited text must hash to the cited
 * hash. Each failure names itself so a quarantine is diagnosable
 * from the record alone.
 */
function describeAnchorFailure(text: string, anchor: EvidenceAnchor): string | null {
  if (anchor.startOffset > anchor.endOffset) {
    return "startOffset exceeds endOffset";
  }
  if (anchor.endOffset > text.length) {
    return "endOffset is beyond the document text";
  }
  const slice = text.slice(anchor.startOffset, anchor.endOffset);
  if (slice !== anchor.exactText) {
    return "the text at the cited offsets does not match exactText";
  }
  if (hashText(anchor.exactText) !== anchor.evidenceHash) {
    return "evidenceHash does not match exactText";
  }
  return null;
}
