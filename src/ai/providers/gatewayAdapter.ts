/**
 * Gateway-routed provider adapter base (Phase 4).
 *
 * Every remote provider request goes to the production gateway, which holds the
 * provider credential. No adapter constructs an `Authorization` header, because
 * no adapter may hold a credential to put in one.
 *
 * This base owns the behavior every provider shares:
 *
 * - abort semantics: a caller abort is non-retryable, an internal timeout is
 *   retryable, and the two are distinguished because both surface as
 *   `AbortError`;
 * - retry with exponential backoff on transient failures only;
 * - redaction before anything is logged;
 * - a single place where a provider name is attached to an error.
 *
 * Provider-specific request and response shapes live in the subclasses, which
 * override `buildRequestBody` and `parseResponse` and nothing else.
 */

import {
  LlmError,
  type LlmAttemptTiming,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from "./LlmProvider";
import { normalizeGatewayOrigin } from "../gateway/gatewayClient";
import { withRetry, type RetryOptions } from "./retry";
import { logger } from "../../shared/utils/logger";
import { redactSensitiveText } from "../../shared/utils/redaction";
import {
  ProviderConnectionSchema,
  type ProviderConnection,
} from "../../core/domain/ProviderConnection";

export interface GatewayAdapterOptions {
  /** Deployment-configured gateway origin, or a same-origin path. */
  gatewayBaseUrl: string;
  connection: ProviderConnection;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

/**
 * Whether the supplied connection may be used for a request.
 *
 * A connection must be `connected`, and a policy-rejected base origin is
 * refused even when it was persisted earlier. Policy is re-evaluated on use
 * rather than trusted from storage.
 */
export function connectionRefusal(
  provider: string,
  connection: ProviderConnection,
): LlmError | null {
  const parsed = ProviderConnectionSchema.safeParse(connection);
  if (!parsed.success) {
    return new LlmError(`${provider} connection is not a valid record`, provider, false);
  }
  if (parsed.data.provider !== provider) {
    return new LlmError(
      `${provider} adapter was given a ${parsed.data.provider} connection`,
      provider,
      false,
    );
  }
  if (parsed.data.status !== "connected") {
    return new LlmError(
      `${provider} connection is not ready (status: ${parsed.data.status})`,
      provider,
      false,
    );
  }
  if (parsed.data.baseOrigin?.classification === "policyRejected") {
    return new LlmError(
      `${provider} connection uses a base URL that deployment policy refuses`,
      provider,
      false,
    );
  }
  return null;
}

export abstract class GatewayRoutedAdapter implements LlmProvider {
  abstract readonly name: string;

  protected readonly gatewayBaseUrl: string;
  protected readonly connection: ProviderConnection;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(opts: GatewayAdapterOptions) {
    // An origin the gateway policy does not accept is treated as no origin at
    // all rather than passed to `fetch`: the adapter then reports itself
    // unconfigured and refuses the request instead of contacting a host no
    // deployment rule approved.
    this.gatewayBaseUrl = normalizeGatewayOrigin(opts.gatewayBaseUrl) ?? "";
    this.connection = opts.connection;
    // Bind `fetch` to the global object: storing the unbound function and
    // calling it as `this.fetchImpl(...)` makes `this` the class instance,
    // which throws "Illegal invocation" in the browser.
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /** True when this adapter has a usable connection and a gateway origin. */
  get configured(): boolean {
    return this.gatewayBaseUrl.length > 0 && connectionRefusal(this.name, this.connection) === null;
  }

  /** Provider-native request body. Implemented per provider. */
  protected abstract buildRequestBody(request: LlmRequest): unknown;

  /** Provider-native response parsing. Implemented per provider. */
  protected abstract parseResponse(payload: unknown): LlmResponse;

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (this.gatewayBaseUrl.length === 0) {
      throw new LlmError(`${this.name} has no gateway configured`, this.name, false);
    }
    const refusal = connectionRefusal(this.name, this.connection);
    if (refusal) throw refusal;
    if (request.signal?.aborted) {
      throw new LlmError(`${this.name} request aborted by caller`, this.name, false);
    }

    /*
     * One record per attempt, so a request that costs several calls reports that
     * cost rather than hiding it behind a single total. `onAttempt` fills each
     * record's duration and the backoff before it; `doComplete` fills the
     * send/receive split, which only it can see.
     */
    const attemptTimings: LlmAttemptTiming[] = [];
    const retryOptions: RetryOptions = {
      maxRetries: this.maxRetries,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
      isRetryable: (err: unknown) => err instanceof LlmError && err.retryable,
      retryAfterMs: (err: unknown) => (err instanceof LlmError ? err.retryAfterMs : undefined),
      onAttempt: ({ index, durationMs, waitMs, outcome }) => {
        const record = attemptTimings[index];
        if (record === undefined) return;
        record.durationMs = durationMs;
        record.waitMs = waitMs;
        record.outcome = outcome;
      },
    };
    /*
     * The adapter owns retrying, and it is the only layer that does. `attempt`
     * reports how many provider calls the request cost, because this is the only
     * place that knows — an engine that retried on top of this turned a transient
     * failure into a burst and could not report the calls it never saw.
     */
    try {
      const response = await withRetry(() => {
        const record: LlmAttemptTiming = { durationMs: 0, waitMs: 0, outcome: "error" };
        attemptTimings.push(record);
        return this.doComplete(request, record);
      }, retryOptions);
      return { ...response, attempt: attemptTimings.length, attemptTimings };
    } catch (error: unknown) {
      /*
       * Carry the attempts on the failure too. The throw is the only thing a caller
       * receives, and the *shape* of the attempts is what explains a request that
       * hung until each of its own deadlines — which no single total can show.
       */
      if (error instanceof LlmError) {
        throw new LlmError(
          error.message,
          error.provider,
          error.retryable,
          error.status,
          error.retryAfterMs,
          attemptTimings,
        );
      }
      throw error;
    }
  }

  redact(text: string): string {
    return redactSensitiveText(text);
  }

  private async doComplete(request: LlmRequest, record: LlmAttemptTiming): Promise<LlmResponse> {
    const external = request.signal;
    let abortedByCaller = false;
    const onAbort = (): void => {
      abortedByCaller = true;
    };
    external?.addEventListener("abort", onAbort, { once: true });

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutFor(request));

    let signal: AbortSignal;
    let detachForward: (() => void) | undefined;
    if (typeof AbortSignal.any === "function") {
      signal = AbortSignal.any([timeoutController.signal, external ?? timeoutController.signal]);
    } else {
      /*
       * Older hosts have no `AbortSignal.any`. Falling back to the timeout signal
       * alone silently dropped the caller's abort, so a reviewer who cancelled
       * kept waiting on a request they had already given up on. Forward the
       * caller's signal into the timeout controller by hand instead — the same
       * thing `any` does, using only what those hosts do support.
       */
      if (external !== undefined) {
        const forward = (): void => timeoutController.abort();
        if (external.aborted) {
          timeoutController.abort();
        } else {
          external.addEventListener("abort", forward, { once: true });
          detachForward = () => external.removeEventListener("abort", forward);
        }
      }
      signal = timeoutController.signal;
    }

    try {
      const sentAt = Date.now();
      const res = await this.fetchImpl(
        `${this.gatewayBaseUrl}/v1/connections/${encodeURIComponent(
          this.connection.connectionId,
        )}/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.buildRequestBody(request)),
          signal,
        },
      );
      // Time to first byte: how long the gateway/provider took to answer at all. A
      // request that never answers leaves this (and `bodyMs`) unset, with the whole
      // wait in the attempt's `durationMs` — which is how "no answer" is told apart
      // from "answered slowly".
      record.headersMs = Date.now() - sentAt;
      record.status = res.status;

      if (!res.ok) {
        throw this.fromStatus(res.status, res.statusText, res.headers);
      }
      const bodyStartedAt = Date.now();
      const parsed = this.parseResponse((await res.json()) as unknown);
      record.bodyMs = Date.now() - bodyStartedAt;
      return parsed;
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        if (abortedByCaller) {
          throw new LlmError(`${this.name} request aborted by caller`, this.name, false);
        }
        throw new LlmError(`${this.name} request timed out`, this.name, true);
      }
      if (err instanceof TypeError) {
        throw new LlmError(`${this.name} network error`, this.name, true);
      }
      // Log the type only; the untrusted message is redacted before it could be
      // recorded, because an error body may echo a credential.
      logger.error(`${this.name} request failed`, {
        errorType: err instanceof Error ? err.name : "Unknown",
        detail: redactSensitiveText(err instanceof Error ? err.message : String(err)),
      });
      throw new LlmError(`${this.name} request failed`, this.name, false);
    } finally {
      clearTimeout(timer);
      detachForward?.();
      external?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * The deadline for this request, raised for a larger prompt.
   *
   * A prompt carrying a style profile and a long selection legitimately takes
   * longer than a two-line one, and a flat deadline refused the larger requests
   * a review actually sends. This only ever raises the configured timeout, which
   * stays the floor, so a deployment that lowered it keeps its own value for
   * ordinary prompts.
   */
  private timeoutFor(request: LlmRequest): number {
    const promptChars = request.prompt.length;
    const floor = promptChars > 16_000 ? 60_000 : promptChars > 8_000 ? 45_000 : this.timeoutMs;
    const timeoutMs = Math.max(this.timeoutMs, floor);
    if (timeoutMs !== this.timeoutMs) {
      logger.info(`${this.name} raised its request timeout for a large prompt`, {
        promptChars,
        timeoutMs,
      });
    }
    return timeoutMs;
  }

  private fromStatus(status: number, statusText: string, headers?: Headers): LlmError {
    // 401/403 mean the gateway rejected this connection. Retrying cannot help
    // and would hide the real reason from the user, so they are not retryable.
    const retryable = status === 429 || status >= 500;
    return new LlmError(
      `${this.name} gateway HTTP ${status}: ${statusText}`,
      this.name,
      retryable,
      // Carried on the error so a caller classifies the failure from the status
      // rather than from this message, which is redacted before it is logged.
      status,
      retryAfterMs(headers),
    );
  }
}

/**
 * The provider's own wait, when it asked for one.
 *
 * `Retry-After` is either a number of seconds or an HTTP date, and both are legal,
 * so both are read. An unparseable value is treated as "no request" rather than as
 * zero: guessing short on a rate limit is how a retry becomes a second refusal.
 */
function retryAfterMs(headers: Headers | undefined): number | undefined {
  const raw = headers?.get("retry-after");
  if (raw === null || raw === undefined || raw.trim().length === 0) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}
