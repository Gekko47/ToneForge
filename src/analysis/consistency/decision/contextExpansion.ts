/**
 * Context expansion (R5, original §23).
 *
 * Typed CTX-* expansion, index-first, one pass.
 * Rules:
 * 1. Retrieve only requested context
 * 2. Index-first
 * 3. Never append whole report
 * 4. One expansion pass by default
 * 5. Rerun only unanswered questions
 * 6. Still unresolved → insufficient evidence
 * No agentic loop.
 */

import type { ConsistencyIndices } from "../indices/buildIndices";
import type { NormalisedClaim } from "../normalisation";
import type { ConsistencyCandidate } from "../contracts";
import type { ContextRequestKind } from "../contracts/plan";

/**
 * Context request types (original §23).
 *
 * Aliased to the plan contract's enum so the vocabulary has one source. The
 * plan owns what a question may ask for; this module owns how it is retrieved.
 */
export type ContextRequestType = ContextRequestKind;

/** A context request from the decision model. */
export interface ContextRequest {
  readonly type: ContextRequestType;
  readonly candidateId: string;
  readonly parameters: Record<string, unknown>;
}

/** The result of a context expansion. */
export interface ContextExpansionResult {
  readonly request: ContextRequest;
  readonly content: string;
  readonly source: "index" | "document";
}

/** Expand context for a set of requests. */
export function expandContext(
  requests: readonly ContextRequest[],
  indices: ConsistencyIndices,
  claims: readonly NormalisedClaim[],
  candidates: readonly ConsistencyCandidate[],
  documentText: string,
): ContextExpansionResult[] {
  const results: ContextExpansionResult[] = [];

  for (const request of requests) {
    const content = expandSingleContext(request, indices, claims, candidates, documentText);
    results.push({
      request,
      content,
      source: "index",
    });
  }

  return results;
}

/**
 * The normalised claims a candidate retrieved.
 *
 * A `ContextRequest` names a candidate, not a claim: the model asks
 * about the subject it is deciding, and the candidate holds the claims
 * that subject grouped. Resolving through the candidate keeps the
 * request honest — a claim id that is not in the candidate is not
 * context for it.
 */
function claimsForCandidate(
  candidateId: string,
  candidates: readonly ConsistencyCandidate[],
  claims: readonly NormalisedClaim[],
): NormalisedClaim[] {
  const candidate = candidates.find((c) => c.id === candidateId);
  if (candidate === undefined) return [];
  const ids = new Set(candidate.claimIds);
  return claims.filter((c) => ids.has(c.claim.id));
}

/** Expand a single context request. */
function expandSingleContext(
  request: ContextRequest,
  indices: ConsistencyIndices,
  claims: readonly NormalisedClaim[],
  candidates: readonly ConsistencyCandidate[],
  documentText: string,
): string {
  switch (request.type) {
    case "CTX-SURROUNDING-PARAGRAPHS":
      return expandSurroundingParagraphs(request, indices, claims, candidates, documentText);
    case "CTX-EVENT-HISTORY":
      return expandEventHistory(request, indices, claims);
    case "CTX-PROGRAMME-HISTORY":
      return expandProgrammeHistory(request, indices, claims);
    case "CTX-TERM-DEFINITION":
      return expandTermDefinition(request, indices, claims);
    case "CTX-RELATED-CLAIMS":
      return expandRelatedClaims(request, indices, claims, candidates);
    case "CTX-VALUATION-BASIS":
      return expandValuationBasis(request, indices, claims, candidates);
    case "CTX-MEASUREMENT-BASIS":
      return expandMeasurementBasis(request, indices, claims, candidates);
    case "CTX-REFERENCE-CONTENT":
      return expandReferenceContent(request, indices, claims);
    case "CTX-SECTION-SUMMARY":
      return expandSectionSummary(request, indices, claims, documentText);
    default:
      return `Unknown context type: ${request.type}`;
  }
}

/** CTX-SURROUNDING-PARAGRAPHS: surrounding paragraph text. */
function expandSurroundingParagraphs(
  request: ContextRequest,
  _indices: ConsistencyIndices,
  claims: readonly NormalisedClaim[],
  candidates: readonly ConsistencyCandidate[],
  documentText: string,
): string {
  const candidateClaims = claimsForCandidate(request.candidateId, candidates, claims);
  if (candidateClaims.length === 0) return "Candidate not found";

  const paragraphId = candidateClaims[0]?.claim.evidence?.paragraphId;
  if (paragraphId === undefined) return "No paragraph ID";

  // Extract surrounding paragraphs from document text
  // This is a simplified implementation - in practice would use the section index
  const lines = documentText.split("\n");
  const paraIndex = lines.findIndex((line) => line.includes(paragraphId));
  if (paraIndex === -1) return "Paragraph not found in document";

  const start = Math.max(0, paraIndex - 2);
  const end = Math.min(lines.length, paraIndex + 3);
  return lines.slice(start, end).join("\n");
}

/** CTX-EVENT-HISTORY: all claims about an event. */
function expandEventHistory(
  request: ContextRequest,
  indices: ConsistencyIndices,
  claims: readonly NormalisedClaim[],
): string {
  const eventId = request.parameters.eventId as string | undefined;
  if (eventId === undefined) return "No event ID provided";

  const claimIds = indices.events.claimsFor(eventId);
  const eventClaims = claimIds
    .map((id: string) => claims.find((c) => c.claim.id === id))
    .filter((c): c is NormalisedClaim => c !== undefined);

  if (eventClaims.length === 0) return "No claims found for event";

  return eventClaims.map((c) => `${c.claim.id}: ${c.claim.predicate.text}`).join("\n");
}

/** CTX-PROGRAMME-HISTORY: all claims about a programme. */
function expandProgrammeHistory(
  request: ContextRequest,
  indices: ConsistencyIndices,
  claims: readonly NormalisedClaim[],
): string {
  const programmeId = request.parameters.programmeId as string | undefined;
  if (programmeId === undefined) return "No programme ID provided";

  const claimIds = indices.programmes.claimsFor(programmeId);
  const programmeClaims = claimIds
    .map((id: string) => claims.find((c) => c.claim.id === id))
    .filter((c): c is NormalisedClaim => c !== undefined);

  if (programmeClaims.length === 0) return "No claims found for programme";

  return programmeClaims.map((c) => `${c.claim.id}: ${c.claim.predicate.text}`).join("\n");
}

/** CTX-TERM-DEFINITION: definition of a term. */
function expandTermDefinition(
  request: ContextRequest,
  indices: ConsistencyIndices,
  claims: readonly NormalisedClaim[],
): string {
  const term = request.parameters.term as string | undefined;
  if (term === undefined) return "No term provided";

  const claimIds = indices.terminology.claimsFor(term);
  const definitions = claimIds
    .map((id: string) => claims.find((c) => c.claim.id === id))
    .filter((c): c is NormalisedClaim => c !== undefined)
    .filter(
      (c) => c.claim.claimClass === "EXPERT_OPINION" || c.claim.claimClass === "EXPERT_CONCLUSION",
    );

  if (definitions.length === 0) return "No definition found for term";

  return definitions.map((c) => `${c.claim.id}: ${c.claim.predicate.text}`).join("\n");
}

/** CTX-RELATED-CLAIMS: claims sharing entity/event. */
function expandRelatedClaims(
  request: ContextRequest,
  indices: ConsistencyIndices,
  claims: readonly NormalisedClaim[],
  candidates: readonly ConsistencyCandidate[],
): string {
  const candidateClaims = claimsForCandidate(request.candidateId, candidates, claims);
  if (candidateClaims.length === 0) return "Candidate not found";

  const candidateClaimIds = new Set(candidateClaims.map((c) => c.claim.id));
  const entityIds = candidateClaims.flatMap((c) => c.claim.subjectIds);
  const eventIds = candidateClaims.flatMap((c) => c.claim.eventIds);

  const relatedIds = new Set<string>();
  for (const entityId of entityIds) {
    const ids = indices.entities.claimsFor(entityId);
    ids.forEach((id: string) => relatedIds.add(id));
  }
  for (const eventId of eventIds) {
    const ids = indices.events.claimsFor(eventId);
    ids.forEach((id: string) => relatedIds.add(id));
  }

  const relatedClaims = [...relatedIds]
    .map((id: string) => claims.find((c) => c.claim.id === id))
    .filter((c): c is NormalisedClaim => c !== undefined)
    .filter((c) => !candidateClaimIds.has(c.claim.id));

  if (relatedClaims.length === 0) return "No related claims found";

  return relatedClaims.map((c) => `${c.claim.id}: ${c.claim.predicate.text}`).join("\n");
}

/** CTX-VALUATION-BASIS: valuation period and method. */
function expandValuationBasis(
  request: ContextRequest,
  _indices: ConsistencyIndices,
  claims: readonly NormalisedClaim[],
  candidates: readonly ConsistencyCandidate[],
): string {
  const candidateClaims = claimsForCandidate(request.candidateId, candidates, claims);
  if (candidateClaims.length === 0) return "Candidate not found";

  const parts: string[] = [];
  for (const claim of candidateClaims) {
    const quantum = claim.claim.quantum;
    if (quantum === undefined) continue;
    if (quantum.valuationPeriod !== undefined) {
      const vp = quantum.valuationPeriod;
      parts.push(`Valuation period: ${vp.start?.raw ?? "unknown"} to ${vp.end?.raw ?? "unknown"}`);
    }
    if (quantum.valuationMethod !== undefined) {
      parts.push(`Valuation method: ${quantum.valuationMethod}`);
    }
    if (quantum.basis !== undefined) {
      parts.push(`Basis: ${quantum.basis}`);
    }
  }

  return parts.length > 0 ? parts.join("\n") : "No valuation basis information";
}

/** CTX-MEASUREMENT-BASIS: delay analysis method. */
function expandMeasurementBasis(
  request: ContextRequest,
  _indices: ConsistencyIndices,
  claims: readonly NormalisedClaim[],
  candidates: readonly ConsistencyCandidate[],
): string {
  const candidateClaims = claimsForCandidate(request.candidateId, candidates, claims);
  if (candidateClaims.length === 0) return "Candidate not found";

  const parts: string[] = [];
  for (const claim of candidateClaims) {
    const delay = claim.claim.delay;
    if (delay === undefined) continue;
    if (delay.analysisMethod !== undefined) {
      parts.push(`Analysis method: ${delay.analysisMethod}`);
    }
    if (delay.analysisWindow !== undefined) {
      const aw = delay.analysisWindow;
      parts.push(`Analysis window: ${aw.start?.raw ?? "unknown"} to ${aw.end?.raw ?? "unknown"}`);
    }
    if (delay.programmeBasis !== undefined) {
      parts.push(`Programme basis: ${delay.programmeBasis}`);
    }
  }

  return parts.length > 0 ? parts.join("\n") : "No measurement basis information";
}

/** CTX-REFERENCE-CONTENT: content of a cited reference. */
function expandReferenceContent(
  request: ContextRequest,
  indices: ConsistencyIndices,
  claims: readonly NormalisedClaim[],
): string {
  const reference = request.parameters.reference as string | undefined;
  if (reference === undefined) return "No reference provided";

  const claimIds = indices.references.claimsFor(reference);
  const refClaims = claimIds
    .map((id: string) => claims.find((c) => c.claim.id === id))
    .filter((c): c is NormalisedClaim => c !== undefined);

  if (refClaims.length === 0) return "No claims cite this reference";

  return refClaims.map((c) => `${c.claim.id}: ${c.claim.predicate.text}`).join("\n");
}

/** CTX-SECTION-SUMMARY: summary of a section. */
function expandSectionSummary(
  request: ContextRequest,
  indices: ConsistencyIndices,
  claims: readonly NormalisedClaim[],
  documentText: string,
): string {
  const section = request.parameters.section as string | undefined;
  if (section === undefined) return "No section provided";

  const claimIds = indices.sections.claimsFor(section);
  const sectionClaims = claimIds
    .map((id: string) => claims.find((c) => c.claim.id === id))
    .filter((c): c is NormalisedClaim => c !== undefined);

  if (sectionClaims.length === 0) return "No claims in section";

  // Also try to extract section text from document
  const sectionIndex = documentText.indexOf(`## ${section}`);
  if (sectionIndex !== -1) {
    const nextSectionIndex = documentText.indexOf("\n## ", sectionIndex + 1);
    const end = nextSectionIndex !== -1 ? nextSectionIndex : sectionIndex + 2000;
    const sectionText = documentText.slice(sectionIndex, end);
    return `Section text:\n${sectionText}\n\nClaims in section:\n${sectionClaims.map((c) => `${c.claim.id}: ${c.claim.predicate.text}`).join("\n")}`;
  }

  return sectionClaims.map((c) => `${c.claim.id}: ${c.claim.predicate.text}`).join("\n");
}
