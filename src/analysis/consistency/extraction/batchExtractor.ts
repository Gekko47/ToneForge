/**
 * Pass A: local extraction (original §7).
 *
 * One provider call per batch, so the model sees one
 * section at a time. Every call goes through `withRetry`
 * for transient failures, carries the caller's
 * AbortSignal, and its output is parsed against the
 * strict extraction schema: malformed output is
 * rejected and counted, never trusted.
 *
 * The model quotes evidence; ToneForge proves it. Each
 * quoted span is located in the paragraph the model
 * named, and the anchor carries the document-absolute
 * offsets and the content hash. A quote that cannot be
 * located is an unsupported fact: the claim is
 * quarantined with the reason, and the quarantine is
 * counted so a refused claim is never silent.
 */

import { hashText } from "../../../shared/utils/text";
import { LlmError, type LlmProvider, type LlmRequest } from "../../../ai/providers/LlmProvider";
import { withRetry } from "../../../ai/providers/retry";
import {
  ExpertReportClaimSchema,
  type EvidenceAnchor,
  type ExpertReportClaim,
  type QuarantinedClaim,
} from "../contracts";
import type { ExtractionBatch } from "./batch";
import {
  buildExtractionPrompt,
  ExtractionResponseSchema,
  type ExtractionResponse,
  type RawEvidence,
} from "./prompt";

/** What the extractor needs beyond the batches. */
export interface ExtractionDocument {
  documentId: string;
  text: string;
  reviewSessionId: string;
}

/** Caller-supplied controls for the extraction calls. */
export interface ExtractionCallOptions {
  signal?: AbortSignal;
  now?: () => string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/** What Pass A produces: resolved claims and the refusals. */
export interface ExtractionResult {
  claims: ExpertReportClaim[];
  quarantined: QuarantinedClaim[];
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 4000;

/** Only transient provider failures are retryable. */
function isRetryable(err: unknown): boolean {
  return err instanceof LlmError && err.retryable;
}

type ParsedResponse = { ok: true; response: ExtractionResponse } | { ok: false; reason: string };

/**
 * Parse one provider response, or say why it was rejected.
 *
 * The response is untrusted model output: it must be
 * valid JSON and it must match the strict extraction
 * schema. Anything else is rejected with a reason that
 * names the first offending field, so the quarantine
 * record is diagnosable on its own.
 */
function parseExtractionResponse(text: string): ParsedResponse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      reason: `the response was not valid JSON: ${(err as Error).message}`,
    };
  }
  const parsed = ExtractionResponseSchema.safeParse(json);
  if (parsed.success) {
    return { ok: true, response: parsed.data };
  }
  const firstIssue = parsed.error.issues.at(0);
  const detail =
    firstIssue === undefined
      ? "no issues were reported"
      : `${firstIssue.path.join(".")}: ${firstIssue.message}`;
  return {
    ok: false,
    reason: `the response did not match the extraction schema: ${detail}`,
  };
}

type EvidenceLocation = { anchor: EvidenceAnchor } | { failure: string };

/**
 * Locate a quoted span in the paragraph the model named.
 *
 * The quote must appear verbatim in the cited paragraph
 * of the cited batch; the first occurrence wins, so
 * resolution is deterministic. The anchor carries the
 * document-absolute offsets and the content hash of the
 * quoted text, which is what the evidence validator
 * proves afterwards.
 */
function locateEvidence(
  documentId: string,
  batch: ExtractionBatch,
  evidence: RawEvidence,
): EvidenceLocation {
  const paragraph = batch.paragraphs.find(
    (candidate) => candidate.paragraphId === evidence.paragraphId,
  );
  if (paragraph === undefined) {
    return {
      failure: `paragraph ${evidence.paragraphId} is not in batch ${batch.batchId}`,
    };
  }
  const relative = paragraph.text.indexOf(evidence.exactText);
  if (relative < 0) {
    return {
      failure: `the quoted evidence was not found in paragraph ${evidence.paragraphId}`,
    };
  }
  const startOffset = paragraph.startOffset + relative;
  return {
    anchor: {
      documentId,
      sectionId: batch.sectionId,
      sectionPath: [...batch.sectionPath],
      paragraphId: paragraph.paragraphId,
      startOffset,
      endOffset: startOffset + evidence.exactText.length,
      exactText: evidence.exactText,
      evidenceHash: hashText(evidence.exactText),
    },
  };
}

/**
 * Extract claims from every batch, in document order.
 *
 * Each batch is one provider call with the caller's
 * AbortSignal and a zero temperature, retried on
 * transient failures only. Claims receive provisional
 * ids in extraction order — which is document order,
 * because batches are visited in document order — and
 * their evidence is resolved to proven anchors. A
 * batch whose output is rejected, or a claim whose
 * evidence cannot be located, is quarantined with the
 * reason; the run continues, because one bad section
 * must not hide the rest of the document.
 */
export async function extractClaims(
  provider: LlmProvider,
  batches: readonly ExtractionBatch[],
  document: ExtractionDocument,
  opts: ExtractionCallOptions = {},
): Promise<ExtractionResult> {
  const now = opts.now ?? (() => new Date().toISOString());
  const claims: ExpertReportClaim[] = [];
  const quarantined: QuarantinedClaim[] = [];
  let provisional = 0;

  for (const batch of batches) {
    if (opts.signal?.aborted === true) {
      throw new LlmError("Extraction cancelled by caller", provider.name, false);
    }
    const prompt = buildExtractionPrompt(batch, { includeRawText: true });
    const request: LlmRequest = {
      prompt,
      temperature: 0,
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    };
    const response = await withRetry(() => provider.complete(request), {
      maxRetries: opts.maxRetries ?? DEFAULT_MAX_RETRIES,
      baseDelayMs: opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
      maxDelayMs: opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
      isRetryable,
    });

    const parsed = parseExtractionResponse(response.text);
    if (!parsed.ok) {
      quarantined.push({
        claimId: batch.batchId,
        reason: `batch ${batch.batchId} output was rejected: ${parsed.reason}`,
      });
      continue;
    }

    parsed.response.claims.forEach((raw) => {
      provisional += 1;
      const provisionalId = `provisional-${provisional}`;
      const located = locateEvidence(document.documentId, batch, raw.evidence);
      if ("failure" in located) {
        quarantined.push({
          claimId: provisionalId,
          reason: `${located.failure}, so the claim was refused: no unsupported facts`,
        });
        return;
      }
      const parsedClaim = ExpertReportClaimSchema.safeParse({
        id: provisionalId,
        reviewSessionId: document.reviewSessionId,
        claimClass: raw.claimClass,
        predicate: { text: raw.predicate },
        speaker: raw.speaker,
        attributedTo: raw.attributedTo,
        adoptionStatus: raw.adoptionStatus,
        polarity: raw.polarity,
        subjectIds: raw.subjectIds,
        objectIds: raw.objectIds,
        workItemIds: raw.workItemIds,
        eventIds: raw.eventIds,
        programmeIds: raw.programmeIds,
        documentRefIds: raw.documentRefIds,
        temporal: raw.temporal,
        values: raw.values,
        scope: raw.scope,
        delay: raw.delay,
        quantum: raw.quantum,
        causation: raw.causation,
        responsibility: raw.responsibility,
        contractualBasis: raw.contractualBasis,
        modality: raw.modality,
        qualifiers: raw.qualifiers,
        assertionStrength: raw.assertionStrength,
        scenario: raw.scenario,
        evidence: located.anchor,
        extraction: {
          modelId: provider.name,
          pass: "local",
          batchId: batch.batchId,
          extractedAt: now(),
        },
      });
      if (!parsedClaim.success) {
        quarantined.push({
          claimId: provisionalId,
          reason: `a claim in batch ${batch.batchId} did not match the claim schema: ${parsedClaim.error.message}`,
        });
        return;
      }
      claims.push(parsedClaim.data);
    });
  }

  return { claims, quarantined };
}
