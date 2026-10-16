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
  /**
   * How many provider calls this response cost, when the adapter retried.
   *
   * Reported by the adapter because it is the layer that retries — an engine on
   * top of it cannot see the calls it did not make. Optional, and absent from a
   * provider that reports nothing, so the engine reads it as "one unless told
   * otherwise" rather than inventing a number.
   */
  attempt?: number;
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
    /**
     * The HTTP status the gateway answered with, when the failure was one.
     *
     * Carried so a caller can tell "your credentials were refused" from "the
     * provider is busy" without reading the message — which is redacted, and
     * worded for a log rather than for a decision. Explicitly `| undefined`
     * rather than optional, so a transport failure can state that there was no
     * status at all.
     */
    public readonly status: number | undefined = undefined,
    /**
     * How long the provider asked the caller to wait, when it said so.
     *
     * The provider's own answer to "when may I try again" beats any backoff this
     * add-in invents, and honouring it is what turns a rate limit from a guess into
     * a wait that is long enough.
     */
    public readonly retryAfterMs: number | undefined = undefined,
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
