/**
 * Provider gateway client contract (Phase 4).
 *
 * This module defines the *client side* of the production authentication and
 * broker service. No server code lives in this repository: the gateway is an
 * external, deployment-owned service, and everything here is the add-in's
 * typed contract with it.
 *
 * Two properties are load-bearing and are enforced by tests:
 *
 * 1. **Credentials never reach ordinary state.** The session token store is
 *    in-memory only. It has no serialization method, no persistence hook, and
 *    is never written to `Office.roamingSettings`, `localStorage`, the URL, a
 *    log line, or a bundle. A page reload therefore ends the session, which is
 *    the intended behavior.
 * 2. **The browser cannot substitute another user's credential.** Every request
 *    carries the opaque connection reference the service issued, and the
 *    service — not the browser — is responsible for binding that reference to
 *    a session identity.
 *
 * The gateway origin is deployment configuration, never a user-supplied value.
 * A same-origin path or an explicit loopback development origin are both
 * acceptable; anything else must be configured at build time.
 */

import { z } from "zod";
import { logger } from "../../shared/utils/logger";
import { redactSensitiveText } from "../../shared/utils/redaction";
import { withRetry, type RetryOptions } from "../providers/retry";
import {
  ModelCatalogSchema,
  ProviderConnectionSchema,
  type ModelCatalog,
  type ProviderConnection,
  type ProviderId,
} from "../../core/domain/ProviderConnection";

/**
 * Gateway transport error.
 *
 * `retryable` distinguishes a transient failure from a refusal. A refusal is
 * never retried, because retrying a rejected credential or a policy-blocked
 * origin cannot succeed and would mask the real reason from the user.
 */
export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly kind: GatewayErrorKind,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export type GatewayErrorKind =
  | "notConfigured"
  | "unauthorized"
  | "forbidden"
  | "rateLimited"
  | "serverError"
  | "network"
  | "timeout"
  | "aborted"
  | "invalidResponse";

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

/**
 * Whether a gateway origin is acceptable.
 *
 * A same-origin path is fine. A loopback HTTP(S) URL is the local development
 * broker. Everything else must be a production origin supplied by deployment
 * configuration — a user-entered production URL is never accepted here, so the
 * Settings form has no field that can point the add-in at an arbitrary host.
 */
export function isValidGatewayOrigin(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("/")) return !trimmed.startsWith("//");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username !== "" || url.password !== "" || url.hash !== "") return false;
    return isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Normalize a configured gateway origin, or return null when it is unusable.
 *
 * A malformed or untrusted origin is dropped rather than passed to `fetch`, so
 * a corrupt setting degrades to "not configured" instead of sending a request
 * to an unexpected host.
 */
export function normalizeGatewayOrigin(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim().replace(/\/$/, "");
  if (!isValidGatewayOrigin(trimmed)) return null;
  return trimmed;
}

/**
 * In-memory session token store.
 *
 * Deliberately has no `toJSON`, no `serialize`, and no storage write. The
 * `redact()` helper exists so that if a token ever reaches a diagnostic
 * context by accident, it is scrubbed before it can be logged.
 */
export class SessionTokenStore {
  private readonly tokens = new Map<string, string>();

  set(connectionId: string, token: string): void {
    this.tokens.set(connectionId, token);
  }

  get(connectionId: string): string | undefined {
    return this.tokens.get(connectionId);
  }

  has(connectionId: string): boolean {
    return this.tokens.has(connectionId);
  }

  /** Forget one connection's token, e.g. on disconnect or revoke. */
  clear(connectionId: string): void {
    this.tokens.delete(connectionId);
  }

  /** Forget every token, e.g. on sign-out. */
  clearAll(): void {
    this.tokens.clear();
  }

  get size(): number {
    return this.tokens.size;
  }

  /** Diagnostic-safe view: counts only, never a token value. */
  describe(): { connectionCount: number } {
    return { connectionCount: this.tokens.size };
  }
}

/** Schema for a gateway-issued connection response. */
const GatewayConnectionResponseSchema = z.object({
  connectionId: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  authMode: z.string().trim().min(1),
  status: z.string().trim().min(1),
  accountLabel: z.string().trim().min(1).optional(),
  baseOrigin: z
    .object({ origin: z.string().trim().min(1), classification: z.string().trim().min(1) })
    .optional(),
  selectedModel: z.string().trim().min(1).optional(),
  lastVerifiedAt: z.string().trim().min(1).optional(),
  allowCustomModel: z.boolean().optional(),
});

/** Schema for a gateway-issued model catalog response. */
const GatewayModelCatalogResponseSchema = z.object({
  connectionId: z.string().trim().min(1),
  fetchedAt: z.string().trim().min(1),
  expiresAt: z.string().trim().min(1).optional(),
  models: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        displayName: z.string().trim().min(1).optional(),
        description: z.string().trim().min(1).optional(),
        contextWindow: z.number().int().nonnegative().nullish(),
        inputModalities: z.array(z.string().trim().min(1)).optional(),
        outputModalities: z.array(z.string().trim().min(1)).optional(),
        supportsStructuredOutput: z.boolean().optional(),
        supportsTools: z.boolean().optional(),
        supportsReasoning: z.boolean().optional(),
        deprecated: z.boolean().optional(),
      }),
    )
    .default([]),
});

/**
 * Typed contract with the production gateway.
 *
 * Implementations are injected, so tests exercise the contract with a stub and
 * never reach a network. The production implementation is supplied by the
 * task-pane composition layer.
 */
export interface ProviderGatewayClient {
  /** Begin an authorization flow and return the URL the user must visit. */
  startAuthorization(provider: ProviderId, signal?: AbortSignal): Promise<string>;
  /** Complete an authorization flow and return the resulting connection. */
  completeAuthorization(
    provider: ProviderId,
    callbackUrl: string,
    signal?: AbortSignal,
  ): Promise<ProviderConnection>;
  /** Submit a user-supplied OpenRouter key once and return the connection. */
  submitBrokerApiKey(
    provider: ProviderId,
    apiKey: string,
    baseUrl: string,
    signal?: AbortSignal,
  ): Promise<ProviderConnection>;
  /** Fetch and normalize the provider's current model catalog. */
  fetchModelCatalog(connection: ProviderConnection, signal?: AbortSignal): Promise<ModelCatalog>;
  /** End the server-side connection and invalidate the local reference. */
  disconnect(connection: ProviderConnection, signal?: AbortSignal): Promise<void>;
}

export interface HttpGatewayOptions {
  /** Deployment-configured origin, or a same-origin path. */
  origin: string;
  tokenStore: SessionTokenStore;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

function classifyStatus(status: number, statusText: string): GatewayError {
  if (status === 401) {
    return new GatewayError("Gateway rejected the session", "unauthorized", false, status);
  }
  if (status === 403) {
    return new GatewayError("Gateway refused the request", "forbidden", false, status);
  }
  if (status === 429) {
    return new GatewayError("Gateway rate limit reached", "rateLimited", true, status);
  }
  if (status >= 500) {
    return new GatewayError(`Gateway server error ${status}`, "serverError", true, status);
  }
  return new GatewayError(
    `Gateway HTTP ${status}: ${statusText || "unexpected response"}`,
    "invalidResponse",
    false,
    status,
  );
}

/**
 * HTTP implementation of the gateway contract.
 *
 * The caller abort is non-retryable; an internal timeout is retryable. The two
 * are distinguished by tracking which signal fired, because both surface as an
 * `AbortError`.
 */
export class HttpProviderGatewayClient implements ProviderGatewayClient {
  private readonly origin: string | null;
  private readonly tokenStore: SessionTokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(opts: HttpGatewayOptions) {
    this.origin = normalizeGatewayOrigin(opts.origin);
    this.tokenStore = opts.tokenStore;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /** True when a usable deployment origin is configured. */
  get configured(): boolean {
    return this.origin !== null;
  }

  async startAuthorization(provider: ProviderId, signal?: AbortSignal): Promise<string> {
    const body = await this.request("POST", "/v1/connections/authorize", { provider }, signal);
    const url = (body as { authorizationUrl?: unknown }).authorizationUrl;
    if (typeof url !== "string" || url.length === 0) {
      throw new GatewayError(
        "Gateway did not return an authorization URL",
        "invalidResponse",
        false,
      );
    }
    return url;
  }

  async completeAuthorization(
    provider: ProviderId,
    callbackUrl: string,
    signal?: AbortSignal,
  ): Promise<ProviderConnection> {
    const body = await this.request(
      "POST",
      "/v1/connections/callback",
      { provider, callbackUrl },
      signal,
    );
    return parseConnection(body, provider);
  }

  /**
   * Submit a user-supplied key exactly once.
   *
   * The key is sent in the request body to the authenticated gateway and is
   * never retained: it is not stored, not logged, and not echoed back. The
   * returned record contains only the opaque connection reference.
   */
  async submitBrokerApiKey(
    provider: ProviderId,
    apiKey: string,
    baseUrl: string,
    signal?: AbortSignal,
  ): Promise<ProviderConnection> {
    const trimmedKey = apiKey.trim();
    if (trimmedKey.length === 0) {
      throw new GatewayError("An API key is required", "invalidResponse", false);
    }
    const body = await this.request(
      "POST",
      "/v1/connections/api-key",
      { provider, apiKey: trimmedKey, baseUrl },
      signal,
    );
    return parseConnection(body, provider);
  }

  async fetchModelCatalog(
    connection: ProviderConnection,
    signal?: AbortSignal,
  ): Promise<ModelCatalog> {
    const body = await this.request(
      "GET",
      `/v1/connections/${encodeURIComponent(connection.connectionId)}/models`,
      undefined,
      signal,
      connection.connectionId,
    );
    const parsed = GatewayModelCatalogResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new GatewayError(
        "Gateway returned an unreadable model catalog",
        "invalidResponse",
        false,
      );
    }
    // The catalog is bound to the connection that produced it. A response for
    // a different connection is refused rather than silently accepted.
    if (parsed.data.connectionId !== connection.connectionId) {
      throw new GatewayError(
        "Model catalog does not belong to the requested connection",
        "invalidResponse",
        false,
      );
    }
    const result = ModelCatalogSchema.safeParse({
      provider: connection.provider,
      connectionId: parsed.data.connectionId,
      fetchedAt: parsed.data.fetchedAt,
      expiresAt: parsed.data.expiresAt,
      models: parsed.data.models.map((model) => ({
        id: model.id,
        // A provider that omits a display name still yields a usable label.
        displayName: model.displayName ?? model.id,
        description: model.description ?? "",
        contextWindow: model.contextWindow ?? null,
        inputModalities: model.inputModalities ?? [],
        outputModalities: model.outputModalities ?? [],
        supportsStructuredOutput: model.supportsStructuredOutput ?? false,
        supportsTools: model.supportsTools ?? false,
        supportsReasoning: model.supportsReasoning ?? false,
        deprecated: model.deprecated ?? false,
      })),
    });
    if (!result.success) {
      throw new GatewayError("Gateway model catalog failed validation", "invalidResponse", false);
    }
    return result.data;
  }

  async disconnect(connection: ProviderConnection, signal?: AbortSignal): Promise<void> {
    // Forget the local token in `finally`, not after a successful call. The user
    // asked to end this connection, so the browser must stop being able to use
    // it even when the network request fails. Clearing only on success would
    // leave a usable credential in memory after a failed disconnect.
    try {
      await this.request(
        "DELETE",
        `/v1/connections/${encodeURIComponent(connection.connectionId)}`,
        undefined,
        signal,
        connection.connectionId,
      );
    } finally {
      this.tokenStore.clear(connection.connectionId);
    }
  }

  /** Store a session token issued by the gateway. Never persisted. */
  setSessionToken(connectionId: string, token: string): void {
    this.tokenStore.set(connectionId, token);
  }

  private async request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    payload: unknown,
    signal?: AbortSignal,
    connectionId?: string,
  ): Promise<unknown> {
    if (!this.origin) {
      throw new GatewayError(
        "No provider gateway is configured for this deployment",
        "notConfigured",
        false,
      );
    }
    if (signal?.aborted) {
      throw new GatewayError("Gateway request aborted by caller", "aborted", false);
    }

    const token = connectionId ? this.tokenStore.get(connectionId) : undefined;
    const retryOptions: RetryOptions = {
      maxRetries: this.maxRetries,
      baseDelayMs: 500,
      maxDelayMs: 4000,
      isRetryable: (err: unknown) => err instanceof GatewayError && err.retryable,
    };

    return withRetry(
      () => this.performRequest(method, `${this.origin}${path}`, payload, signal, token),
      retryOptions,
    );
  }

  private async performRequest(
    method: "GET" | "POST" | "DELETE",
    url: string,
    payload: unknown,
    signal: AbortSignal | undefined,
    token: string | undefined,
  ): Promise<unknown> {
    let abortedByCaller = false;
    const onAbort = (): void => {
      abortedByCaller = true;
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);

    let combined: AbortSignal;
    if (typeof AbortSignal.any === "function") {
      combined = AbortSignal.any([timeoutController.signal, signal ?? timeoutController.signal]);
    } else {
      combined = timeoutController.signal;
    }

    try {
      // Build the init object without an explicit `undefined` body:
      // `exactOptionalPropertyTypes` is on, so passing `undefined` for an
      // optional property is a type error rather than an implicit omission.
      const init: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
          // The browser presents its own session reference; the gateway is
          // responsible for binding it to a real user identity server-side.
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: combined,
      };
      if (payload !== undefined) {
        init.body = JSON.stringify(payload);
      }
      const res = await this.fetchImpl(url, init);

      if (!res.ok) {
        throw classifyStatus(res.status, res.statusText);
      }
      if (res.status === 204) return {};
      return (await res.json()) as unknown;
    } catch (err) {
      if (err instanceof GatewayError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        if (abortedByCaller) {
          throw new GatewayError("Gateway request aborted by caller", "aborted", false);
        }
        throw new GatewayError("Gateway request timed out", "timeout", true);
      }
      if (err instanceof TypeError) {
        throw new GatewayError("Gateway network error", "network", true);
      }
      // Log the error type only. Untrusted error text may embed a response body
      // that contained a key, so it is redacted before it could be recorded.
      logger.error("Provider gateway request failed", {
        errorType: err instanceof Error ? err.name : "Unknown",
        detail: redactSensitiveText(err instanceof Error ? err.message : String(err)),
      });
      throw new GatewayError("Provider gateway request failed", "invalidResponse", false);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

function parseConnection(body: unknown, expectedProvider: ProviderId): ProviderConnection {
  const parsed = GatewayConnectionResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new GatewayError("Gateway returned an unreadable connection", "invalidResponse", false);
  }
  const raw = parsed.data;
  if (raw.provider !== expectedProvider) {
    // A connection for a different provider than the user selected would make
    // the connection reference meaningless to the rest of the workflow.
    throw new GatewayError(
      "Gateway returned a connection for a different provider",
      "invalidResponse",
      false,
    );
  }
  const result = ProviderConnectionSchema.safeParse({
    connectionId: raw.connectionId,
    provider: raw.provider,
    authMode: raw.authMode,
    status: raw.status,
    accountLabel: raw.accountLabel,
    baseOrigin: raw.baseOrigin,
    selectedModel: raw.selectedModel,
    lastVerifiedAt: raw.lastVerifiedAt,
    allowCustomModel: raw.allowCustomModel,
  });
  if (!result.success) {
    throw new GatewayError("Gateway connection failed validation", "invalidResponse", false);
  }
  return result.data;
}

/** Convenience factory used by composition code. */
export function createProviderGatewayClient(
  opts: HttpGatewayOptions,
): ProviderGatewayClient & { configured: boolean } {
  return new HttpProviderGatewayClient(opts);
}
