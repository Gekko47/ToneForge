import { v4 as uuidv4 } from "uuid";
import { withRetry } from "../providers/retry";
import { createLlmRegistry } from "../providers/registry";
import { LlmError, type LlmProvider } from "../providers/LlmProvider";
import { buildSpotPrompt } from "../prompts/spotPrompts";
import { validateChangePreconditions } from "../../changes/preconditions";
import { createChangePlan } from "../../core/domain/ChangePlan";
import { ReviewRequestSchema, type ReviewRequest } from "../../core/domain/ReviewRequest";
import type { GovernanceProfile } from "../../core/domain/GovernanceProfile";
import type { DocumentNode } from "../../core/domain/DocumentSnapshot";
import { buildMinimalContext } from "./contextMinimizer";
import { validateReviewResponse, type ValidatedReview } from "./responseValidator";

/** Explicit caller assertion that the user approved raw-text review for this scope. */
export interface SpotReviewConsent {
  spotReview: true;
}

export interface SpotReviewOptions {
  request: ReviewRequest;
  profile: GovernanceProfile;
  nodes: readonly DocumentNode[];
  includeRawText: true;
  consent: SpotReviewConsent;
  signal?: AbortSignal;
  registry?: LlmProvider;
  /** Document offset corresponding to the first character of request.text. */
  rangeOffset?: number;
  contentHash: string;
  structuralHash?: string;
  charBudget?: number;
}

export interface SpotReviewResult extends ValidatedReview {
  plan: ReturnType<typeof createChangePlan>;
  provider: string;
}

const DEFAULT_RETRIES = 2;

export async function reviewSpot(options: SpotReviewOptions): Promise<SpotReviewResult> {
  const request = ReviewRequestSchema.parse(options.request);
  if (options.consent.spotReview !== true || options.includeRawText !== true) {
    throw new Error("AI spot review requires explicit raw-text consent");
  }
  const rangeOffset = options.rangeOffset ?? 0;
  const context = buildMinimalContext({
    selectedText: request.text,
    nodes: options.nodes,
    targetNodeIds: request.targetNodeIds,
    governance: options.profile,
    ...(options.charBudget === undefined ? {} : { charBudget: options.charBudget }),
  });
  if (context.excludedNodeIds.length > 0) {
    throw new Error("Protected or non-editable content cannot be sent to AI review");
  }
  if (context.unresolvedNodeIds.length > 0 || context.requestedNodeIds.length === 0) {
    throw new Error("Selected text must resolve to one unambiguous in-scope review target");
  }
  if (context.truncated) {
    throw new Error("Selected text exceeds the bounded AI review context budget");
  }
  if (context.text.trim().length === 0) return emptyResult(request, options, "none");

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
    rangeOffset,
  });
  const preconditionProblems = validateChangePreconditions(validated.changes);
  if (preconditionProblems.length > 0) {
    throw new Error(
      `AI review changes lack exact preconditions: ${preconditionProblems.join("; ")}`,
    );
  }
  const plan = createChangePlan(
    options.contentHash,
    request.documentId,
    validated.changes,
    validated.findings,
    {
      schemaVersion: 2,
      documentId: request.documentId,
      documentVersion: request.documentVersion,
      contentHash: options.contentHash,
      profileId: request.profileId,
      profileRevision: request.profileRevision ?? options.profile.style.revision,
      governancePolicyRevision: options.profile.version,
      ...(options.structuralHash === undefined ? {} : { structuralHash: options.structuralHash }),
      validation: {
        protectionChecked: true,
        identityChecked: true,
        rangeChecked: true,
        preconditionsChecked: true,
        approvalsChecked: true,
      },
    },
  );
  return { ...validated, plan, provider: provider.name };
}

export async function reviewParagraph(options: SpotReviewOptions): Promise<SpotReviewResult> {
  return reviewSpot({ ...options, request: { ...options.request, operation: "spot_paragraph" } });
}

function emptyResult(
  request: ReviewRequest,
  options: SpotReviewOptions,
  provider: string,
): SpotReviewResult {
  return {
    findings: [],
    changes: [],
    plan: createChangePlan(options.contentHash, request.documentId, [], [], {
      schemaVersion: 2,
      documentId: request.documentId,
      documentVersion: request.documentVersion,
      contentHash: options.contentHash,
      profileId: request.profileId,
      profileRevision: request.profileRevision,
      governancePolicyRevision: options.profile.version,
      ...(options.structuralHash === undefined ? {} : { structuralHash: options.structuralHash }),
    }),
    provider,
  };
}

export function createSpotReviewRequest(input: Omit<ReviewRequest, "id">): ReviewRequest {
  return ReviewRequestSchema.parse({ ...input, id: uuidv4() });
}
