import { v4 as uuidv4 } from "uuid";
import type { Change } from "../../core/domain/Change";
import type { Finding } from "../../core/domain/Finding";
import type { LlmProvider } from "../providers/LlmProvider";
import { buildCoverage } from "../../analysis/coverage";
import type { CoverageReport, DocumentSnapshot } from "../../core/domain/DocumentSnapshot";
import type { GovernanceProfile } from "../../core/domain/GovernanceProfile";
import { createChangePlan, type ChangePlan } from "../../core/domain/ChangePlan";
import { formatProfileVersion } from "../../core/domain/StyleProfile";
import { validateChangePreconditions } from "../../changes/preconditions";
import { reviewSpot } from "./spotReview";
import { partitionReviewBatches, type ReviewBatch } from "./batcher";
import { consolidateReviewFindings } from "./consolidator";

export interface FullReviewConsent {
  fullDocumentReview: true;
}

export interface FullReviewOptions {
  snapshot: DocumentSnapshot;
  profile: GovernanceProfile;
  includeRawText: true;
  consent: FullReviewConsent;
  registry: LlmProvider;
  currentDocumentVersion?: string;
  /** Read the live content hash before and after every provider batch. */
  getCurrentDocumentHash?: () => Promise<string>;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

export interface FullReviewResult {
  status: "complete" | "failed_coverage" | "cancelled" | "stale";
  coverage: CoverageReport;
  batches: ReviewBatch[];
  findings: ReturnType<typeof consolidateReviewFindings>["findings"];
  plan: ChangePlan;
  provider: string;
  partial: boolean;
}

export async function reviewEntireDocument(options: FullReviewOptions): Promise<FullReviewResult> {
  if (options.consent.fullDocumentReview !== true || options.includeRawText !== true) {
    throw new Error("Full-document AI review requires explicit raw-text consent");
  }
  const coverage = buildCoverage({
    nodes: options.snapshot.nodes,
    text: options.snapshot.fullText ?? options.snapshot.analysisText ?? "",
    ...(options.snapshot.acquisition
      ? {
          acquisition: {
            structuralCoverage: options.snapshot.acquisition.structuralCoverage,
            unsupported: options.snapshot.acquisition.unsupported,
            analyzedCharacterCount: options.snapshot.analysisEnd ?? 0,
            completeDocumentCharacterCount: options.snapshot.fullText?.length ?? 0,
          },
        }
      : {}),
  });
  if (!coverage.complete) {
    return {
      status: "failed_coverage",
      coverage,
      batches: [],
      findings: [],
      plan: emptyPlan(options.snapshot),
      provider: options.registry.name,
      partial: false,
    };
  }

  if (await isDocumentStale(options)) {
    return staleResult(options.snapshot, coverage, [], options.registry.name, false);
  }
  const batches = partitionReviewBatches(options.snapshot.nodes);
  const findings: Finding[] = [];
  const changes: Change[] = [];
  for (const [index, batch] of batches.entries()) {
    if (options.signal?.aborted)
      return cancelledResult(options.snapshot, coverage, batches, options.registry.name);
    if (await isDocumentStale(options)) {
      return staleResult(options.snapshot, coverage, batches, options.registry.name, true);
    }
    const result = await reviewSpot({
      request: {
        id: uuidv4(),
        operation: "document_editorial_review",
        documentId: options.snapshot.documentId,
        documentVersion: options.snapshot.versionToken,
        targetNodeIds: batch.nodeIds,
        text: batch.text,
        profileId: options.profile.id,
        profileVersion: formatProfileVersion(options.profile.style.version),
        privacyPolicyId: "full-document-bounded-v1",
      },
      profile: options.profile,
      nodes: options.snapshot.nodes,
      includeRawText: options.includeRawText,
      consent: { spotReview: true },
      registry: options.registry,
      rangeOffset: batch.startOffset,
      contentHash: options.snapshot.contentHash,
      structuralHash: options.snapshot.structuralHash,
      charBudget: Math.max(batch.characterCount + 1000, 4000),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (await isDocumentStale(options)) {
      return staleResult(options.snapshot, coverage, batches, options.registry.name, true);
    }
    findings.push(...result.findings);
    changes.push(...result.changes);
    options.onProgress?.(index + 1, batches.length);
  }
  const consolidated = consolidateReviewFindings(findings, changes);
  const preconditionProblems = validateChangePreconditions(consolidated.changes);
  if (preconditionProblems.length > 0) {
    return failedCoverageResult(
      options.snapshot,
      coverage,
      options.registry.name,
      `AI review changes lack exact preconditions: ${preconditionProblems.join("; ")}`,
    );
  }
  const plan = createChangePlan(
    options.snapshot.contentHash,
    options.snapshot.documentId,
    consolidated.changes,
    consolidated.findings,
    {
      schemaVersion: 2,
      documentId: options.snapshot.documentId,
      documentVersion: options.snapshot.versionToken,
      contentHash: options.snapshot.contentHash,
      structuralHash: options.snapshot.structuralHash,
      profileId: options.profile.id,
      profileVersion: formatProfileVersion(options.profile.style.version),
      governancePolicyRevision: options.profile.version,
      validation: {
        protectionChecked: true,
        identityChecked: true,
        rangeChecked: true,
        preconditionsChecked: true,
        approvalsChecked: true,
      },
    },
  );
  return {
    status: "complete",
    coverage,
    batches,
    findings: consolidated.findings,
    plan,
    provider: options.registry.name,
    partial: false,
  };
}

async function isDocumentStale(options: FullReviewOptions): Promise<boolean> {
  if (
    options.currentDocumentVersion !== undefined &&
    options.currentDocumentVersion !== options.snapshot.versionToken
  ) {
    return true;
  }
  if (!options.getCurrentDocumentHash) return false;
  return (await options.getCurrentDocumentHash()) !== options.snapshot.contentHash;
}

function staleResult(
  snapshot: DocumentSnapshot,
  coverage: CoverageReport,
  batches: ReviewBatch[],
  provider: string,
  partial: boolean,
): FullReviewResult {
  return {
    status: "stale",
    coverage,
    batches,
    findings: [],
    plan: emptyPlan(snapshot),
    provider,
    partial,
  };
}

function emptyPlan(snapshot: DocumentSnapshot): ChangePlan {
  return createChangePlan(snapshot.contentHash, snapshot.documentId, [], [], {
    schemaVersion: 2,
    documentId: snapshot.documentId,
    documentVersion: snapshot.versionToken,
    contentHash: snapshot.contentHash,
    structuralHash: snapshot.structuralHash,
  });
}

function failedCoverageResult(
  snapshot: DocumentSnapshot,
  coverage: CoverageReport,
  provider: string,
  reason: string,
): FullReviewResult {
  const failedCoverage = {
    ...coverage,
    unprocessed: [...new Set([...coverage.unprocessed, reason])],
    complete: false,
  };
  return {
    status: "failed_coverage",
    coverage: failedCoverage,
    batches: [],
    findings: [],
    plan: emptyPlan(snapshot),
    provider,
    partial: false,
  };
}

function cancelledResult(
  snapshot: DocumentSnapshot,
  coverage: CoverageReport,
  batches: ReviewBatch[],
  provider: string,
): FullReviewResult {
  return {
    status: "cancelled",
    coverage,
    batches,
    findings: [],
    plan: emptyPlan(snapshot),
    provider,
    partial: true,
  };
}
