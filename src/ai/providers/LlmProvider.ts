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
 * `profile()`, `deviations()`, and `rewrite()` contract required by plan.md.
 */
export interface LlmSemanticProvider extends LlmProvider {
  profile(request: LlmRequest): Promise<LlmResponse>;
  deviations(request: LlmRequest): Promise<LlmResponse>;
  rewrite(request: LlmRequest): Promise<LlmResponse>;
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
 * Mixin that adds profile/deviations/rewrite helpers to any LlmProvider.
 * All three delegate to `complete()` and pass through `request.signal`.
 */
export function withSemanticHelpers<T extends LlmProvider>(provider: T): T & LlmSemanticProvider {
  const p = provider as T & LlmSemanticProvider;
  (p as unknown as { profile: (r: LlmRequest) => Promise<LlmResponse> }).profile = (
    request: LlmRequest,
  ) => p.complete(request);
  (p as unknown as { deviations: (r: LlmRequest) => Promise<LlmResponse> }).deviations = (
    request: LlmRequest,
  ) => p.complete(request);
  (p as unknown as { rewrite: (r: LlmRequest) => Promise<LlmResponse> }).rewrite = (
    request: LlmRequest,
  ) => p.complete(request);
  return p as T & LlmSemanticProvider;
}
