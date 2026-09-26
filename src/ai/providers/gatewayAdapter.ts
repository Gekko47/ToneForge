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

import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./LlmProvider";
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
    this.fetchImpl = opts.fetchImpl ?? fetch;
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

    const retryOptions: RetryOptions = {
      maxRetries: this.maxRetries,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
      isRetryable: (err: unknown) => err instanceof LlmError && err.retryable,
    };
    return withRetry(() => this.doComplete(request), retryOptions);
  }

  redact(text: string): string {
    return redactSensitiveText(text);
  }

  private async doComplete(request: LlmRequest): Promise<LlmResponse> {
    const external = request.signal;
    let abortedByCaller = false;
    const onAbort = (): void => {
      abortedByCaller = true;
    };
    external?.addEventListener("abort", onAbort, { once: true });

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);

    let signal: AbortSignal;
    if (typeof AbortSignal.any === "function") {
      signal = AbortSignal.any([timeoutController.signal, external ?? timeoutController.signal]);
    } else {
      signal = timeoutController.signal;
    }

    try {
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

      if (!res.ok) {
        throw this.fromStatus(res.status, res.statusText);
      }
      return this.parseResponse((await res.json()) as unknown);
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
      external?.removeEventListener("abort", onAbort);
    }
  }

  private fromStatus(status: number, statusText: string): LlmError {
    // 401/403 mean the gateway rejected this connection. Retrying cannot help
    // and would hide the real reason from the user, so they are not retryable.
    const retryable = status === 429 || status >= 500;
    return new LlmError(`${this.name} gateway HTTP ${status}: ${statusText}`, this.name, retryable);
  }
}
