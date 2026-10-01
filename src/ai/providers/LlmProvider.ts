/**
 * Provider-agnostic LLM interface.
 * Deterministic engines never call this; only semantic analysis does,
 * and only where interpretation is required (Roadmap "AI only where necessary").
 */

export interface LlmRequest {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmResponse {
  text: string;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
  stream?(request: LlmRequest): AsyncIterable<string>;
  redact?(text: string): string;
}

/**
 * High-level helpers that delegate to `complete()` with AbortSignal passthrough.
 * Concrete adapters implement `complete()`; these helpers provide the
 * `profile()`, `deviations()`, `rewrite()`, and `review()` contract.
 *
 * `review` exists alongside the other three rather than replacing `deviations`
 * and `rewrite` because both of those are still called: the Semantic tab has not
 * been migrated until P7, and a provider that lost a method would turn a
 * migration into an outage. `deviations` and `rewrite` are removed with the page
 * that calls them.
 *
 * All four are the same shape for a reason. A helper that transformed its
 * request, or swallowed the signal, would be a second implementation of the
 * provider contract in a file that looks like a convenience.
 */
export interface LlmSemanticProvider extends LlmProvider {
  profile(request: LlmRequest): Promise<LlmResponse>;
  deviations(request: LlmRequest): Promise<LlmResponse>;
  rewrite(request: LlmRequest): Promise<LlmResponse>;
  /** Semantic Review: assessment and proposed revision in one response. */
  review(request: LlmRequest): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/**
 * Mixin that adds the four semantic helpers to any LlmProvider.
 * All four delegate to `complete()` and pass through `request.signal`.
 *
 * Assigned rather than spread so the provider's own `complete` keeps its `this`.
 */
export function withSemanticHelpers<T extends LlmProvider>(provider: T): T & LlmSemanticProvider {
  const p = provider as T & LlmSemanticProvider;
  const helpers = ["profile", "deviations", "rewrite", "review"] as const;
  helpers.forEach((helper) => {
    (p as unknown as Record<string, (r: LlmRequest) => Promise<LlmResponse>>)[helper] = (
      request: LlmRequest,
    ) => p.complete(request);
  });
  return p as T & LlmSemanticProvider;
}
