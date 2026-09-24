import { v4 as uuidv4 } from "uuid";
import type { Change } from "../../core/domain/Change";
import type { Finding } from "../../core/domain/Finding";
import type { LlmProvider } from "../providers/LlmProvider";
import { buildCoverage } from "../../analysis/coverage";
import type { CoverageReport, DocumentSnapshot } from "../../core/domain/DocumentSnapshot";
import type { GovernanceProfile } from "../../core/domain/GovernanceProfile";
import { createChangePlan, type ChangePlan } from "../../core/domain/ChangePlan";
import { reviewSpot } from "./spotReview";
import { partitionReviewBatches, type ReviewBatch } from "./batcher";
import { consolidateReviewFindings } from "./consolidator";

export interface FullReviewOptions {
  snapshot: DocumentSnapshot;
  profile: GovernanceProfile;
  includeRawText: true;
  registry: LlmProvider;
  currentDocumentVersion?: string;
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
  const coverage = buildCoverage({ nodes: options.snapshot.nodes, text: "" });
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

  if (
    options.currentDocumentVersion !== undefined &&
    options.currentDocumentVersion !== options.snapshot.versionToken
  ) {
    return {
      status: "stale",
      coverage,
      batches: [],
      findings: [],
      plan: emptyPlan(options.snapshot),
      provider: options.registry.name,
      partial: false,
    };
  }
  const batches = partitionReviewBatches(options.snapshot.nodes);
  const findings: Finding[] = [];
  const changes: Change[] = [];
  for (const [index, batch] of batches.entries()) {
    if (options.signal?.aborted)
      return cancelledResult(options.snapshot, coverage, batches, options.registry.name);
    if (
      options.currentDocumentVersion !== undefined &&
      options.currentDocumentVersion !== options.snapshot.versionToken
    ) {
      return {
        status: "stale",
        coverage,
        batches,
        findings: [],
        plan: emptyPlan(options.snapshot),
        provider: options.registry.name,
        partial: true,
      };
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
        profileVersion: String(options.profile.version),
        privacyPolicyId: "full-document-bounded-v1",
      },
      profile: options.profile,
      nodes: options.snapshot.nodes,
      includeRawText: options.includeRawText,
      registry: options.registry,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    findings.push(...result.findings);
    changes.push(...result.changes);
    options.onProgress?.(index + 1, batches.length);
  }
  const consolidated = consolidateReviewFindings(findings, changes);
  const plan = createChangePlan(
    options.snapshot.versionToken,
    options.snapshot.documentId,
    consolidated.changes,
    consolidated.findings,
    {
      documentId: options.snapshot.documentId,
      documentVersion: options.snapshot.versionToken,
      contentHash: options.snapshot.contentHash,
      profileId: options.profile.id,
      profileVersion: String(options.profile.version),
      validation: { protectionChecked: true, identityChecked: true, rangeChecked: true },
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

function emptyPlan(snapshot: DocumentSnapshot): ChangePlan {
  return createChangePlan(snapshot.versionToken, snapshot.documentId, [], [], {
    documentId: snapshot.documentId,
    documentVersion: snapshot.versionToken,
    contentHash: snapshot.contentHash,
  });
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
