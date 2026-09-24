import { v4 as uuidv4 } from "uuid";
import { withRetry } from "../providers/retry";
import { createLlmRegistry } from "../providers/registry";
import { LlmError, type LlmProvider } from "../providers/LlmProvider";
import { buildSpotPrompt } from "../prompts/spotPrompts";
import { createChangePlan } from "../../core/domain/ChangePlan";
import { ReviewRequestSchema, type ReviewRequest } from "../../core/domain/ReviewRequest";
import type { GovernanceProfile } from "../../core/domain/GovernanceProfile";
import type { DocumentNode } from "../../core/domain/DocumentSnapshot";
import { buildMinimalContext } from "./contextMinimizer";
import { validateReviewResponse, type ValidatedReview } from "./responseValidator";

export interface SpotReviewOptions {
  request: ReviewRequest;
  profile: GovernanceProfile;
  nodes?: readonly DocumentNode[];
  includeRawText: true;
  signal?: AbortSignal;
  registry?: LlmProvider;
}

export interface SpotReviewResult extends ValidatedReview {
  plan: ReturnType<typeof createChangePlan>;
  provider: string;
}

const DEFAULT_RETRIES = 2;

export async function reviewSpot(options: SpotReviewOptions): Promise<SpotReviewResult> {
  const request = ReviewRequestSchema.parse(options.request);
  const context = buildMinimalContext({
    selectedText: request.text,
    nodes: options.nodes ?? [],
    targetNodeIds: request.targetNodeIds,
    ...(options.profile ? { governance: options.profile } : {}),
  });
  if (context.excludedNodeIds.length > 0) {
    throw new Error("Protected content cannot be sent to AI review");
  }
  if (context.text.trim().length === 0) return emptyResult(request, "none");

  const prompt = buildSpotPrompt(
    request.operation === "spot_paragraph"
      ? "spot_paragraph"
      : request.operation === "document_editorial_review"
        ? "document_editorial_review"
        : "spot_selection",
    context.text,
    { includeRawText: options.includeRawText },
  );
  const provider = options.registry ?? createLlmRegistry();
  const response = await withRetry(
    () => provider.complete({ prompt, ...(options.signal ? { signal: options.signal } : {}) }),
    {
      maxRetries: DEFAULT_RETRIES,
      baseDelayMs: 200,
      maxDelayMs: 800,
      isRetryable: (error: unknown) => {
        if (error instanceof LlmError) return error.retryable;
        return !options.signal?.aborted;
      },
    },
  );

  let raw: unknown;
  try {
    raw = JSON.parse(response.text);
  } catch {
    throw new Error("AI spot review response is not valid JSON");
  }
  const validated = validateReviewResponse(raw, {
    requestId: request.id,
    targetNodeIds: request.targetNodeIds,
    sourceText: request.text,
  });
  const plan = createChangePlan(
    request.documentVersion,
    request.documentId,
    validated.changes,
    validated.findings,
    {
      documentId: request.documentId,
      documentVersion: request.documentVersion,
      contentHash: request.documentVersion,
      profileId: request.profileId,
      profileVersion: request.profileVersion,
      validation: { protectionChecked: true, identityChecked: true, rangeChecked: true },
    },
  );
  return { ...validated, plan, provider: provider.name };
}

export async function reviewParagraph(options: SpotReviewOptions): Promise<SpotReviewResult> {
  return reviewSpot({ ...options, request: { ...options.request, operation: "spot_paragraph" } });
}

function emptyResult(request: ReviewRequest, provider: string): SpotReviewResult {
  return {
    findings: [],
    changes: [],
    plan: createChangePlan(request.documentVersion, request.documentId, [], [], {
      documentId: request.documentId,
      documentVersion: request.documentVersion,
      contentHash: request.documentVersion,
      profileId: request.profileId,
      profileVersion: request.profileVersion,
    }),
    provider,
  };
}

export function createSpotReviewRequest(input: Omit<ReviewRequest, "id">): ReviewRequest {
  return ReviewRequestSchema.parse({ ...input, id: uuidv4() });
}
