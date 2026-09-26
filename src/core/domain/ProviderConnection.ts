/**
 * Provider-neutral connection contracts (Phase 4).
 *
 * A `ProviderConnection` is ordinary, persistable, non-secret metadata. It holds
 * an opaque connection identifier issued by the production authentication and
 * broker service plus non-secret account/provider/model metadata. It never
 * holds an API key, an OAuth access token, a refresh token, a client secret,
 * or a PKCE verifier: those live in the production service or in the
 * gateway client's in-memory token store and are never persisted here.
 *
 * The lifecycle is deliberately explicit. `disconnected` and `revoked` are
 * terminal for a given connection id; `expired` and `reconnectRequired` are
 * recoverable only through a fresh authorization request, and a fresh request
 * must never reuse a prior `state` or PKCE verifier.
 *
 * Boundary rule: this module imports only `zod`. It is Office-free,
 * AI-free, and UI-free (see docs/architecture.md and ADR-0049).
 */

import { z } from "zod";

/**
 * Supported provider identifiers.
 *
 * `mock` is the offline/deterministic provider. The three named providers are
 * selected through the same provider interface; their authentication mode is a
 * deployment and connection concern, never a UI credential concern.
 */
export const ProviderIdSchema = z.enum(["openai", "anthropic", "openrouter", "mock"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/** Providers that are selectable in the ordinary task-pane experience. */
export const REMOTE_PROVIDER_IDS: readonly ProviderId[] = ["openai", "anthropic", "openrouter"];

export function isRemoteProvider(provider: ProviderId): boolean {
  return provider !== "mock";
}

/**
 * How a provider connection authenticates.
 *
 * - `oauth`: authorization-code + PKCE, completed server-side by the broker.
 * - `deploymentManaged`: the deployment owns the credential; the user never
 *   supplies one. This is the supported OpenAI mode while a general end-user
 *   OpenAI OAuth flow is not officially available.
 * - `brokerApiKey`: the user submitted a key once to the broker. The add-in
 *   retains only the resulting opaque connection reference.
 * - `none`: offline/mock.
 */
export const ConnectionAuthModeSchema = z.enum([
  "oauth",
  "deploymentManaged",
  "brokerApiKey",
  "none",
]);
export type ConnectionAuthMode = z.infer<typeof ConnectionAuthModeSchema>;

/**
 * The connection lifecycle.
 *
 * `startAuthorization` and `callback` are transient handshake states. The seven
 * steady states are the ones the UI renders.
 */
export const ConnectionStatusSchema = z.enum([
  "startAuthorization",
  "callback",
  "connected",
  "reconnectRequired",
  "expired",
  "revoked",
  "disconnected",
  "failed",
]);
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

/** Statuses in which a request may be sent to the provider. */
export const READY_CONNECTION_STATUSES: readonly ConnectionStatus[] = ["connected"];

/** Statuses that are terminal for a given connection id. */
export const TERMINAL_CONNECTION_STATUSES: readonly ConnectionStatus[] = [
  "revoked",
  "disconnected",
];

export function isReadyStatus(status: ConnectionStatus): boolean {
  return READY_CONNECTION_STATUSES.includes(status);
}

export function isTerminalStatus(status: ConnectionStatus): boolean {
  return TERMINAL_CONNECTION_STATUSES.includes(status);
}

/**
 * How a configured base URL was classified.
 *
 * A syntactically valid URL is NOT trusted. Deployment policy decides whether a
 * custom base origin is allowed, so the classification is recorded alongside
 * the value and is part of the persisted contract.
 */
export const BaseOriginClassSchema = z.enum([
  /** Deployment-managed default origin for this provider. */
  "deploymentDefault",
  /** Origin explicitly allowlisted by deployment policy. */
  "policyAllowed",
  /** Self-hosted endpoint the user explicitly approved. */
  "userApprovedSelfHosted",
  /** Loopback development origin. Never valid in a production package. */
  "loopbackDevelopment",
  /** Origin not permitted by deployment policy. Requests must be refused. */
  "policyRejected",
]);
export type BaseOriginClass = z.infer<typeof BaseOriginClassSchema>;

/** Normalized, validated description of a configured base origin. */
export const BaseOriginSchema = z.object({
  /** Origin (scheme + host + port) only; never a path, query, or fragment. */
  origin: z.string().trim().min(1),
  classification: BaseOriginClassSchema,
});
export type BaseOrigin = z.infer<typeof BaseOriginSchema>;

/**
 * Non-secret provider connection record.
 *
 * This is the only provider-related structure that may be persisted. It
 * deliberately has no field capable of holding a secret.
 */
export const ProviderConnectionSchema = z.object({
  /** Opaque, service-issued identifier. Carries no meaning to the add-in. */
  connectionId: z.string().trim().min(1).max(200),
  provider: ProviderIdSchema,
  authMode: ConnectionAuthModeSchema,
  status: ConnectionStatusSchema,
  /** Optional non-secret account label, e.g. a masked account identifier. */
  accountLabel: z.string().trim().min(1).max(120).optional(),
  /** Normalized base origin for providers that accept a configurable base URL. */
  baseOrigin: BaseOriginSchema.optional(),
  /** Currently selected model identifier. Must exist in the current catalog. */
  selectedModel: z.string().trim().min(1).max(200).optional(),
  /** ISO timestamp of the last successful provider verification. */
  lastVerifiedAt: z.string().datetime().optional(),
  /** Set only when `status === "failed"`. Never contains document text. */
  failureReason: z.string().trim().min(1).max(200).optional(),
  /**
   * True when deployment policy permits an explicitly typed custom model that
   * is absent from the fetched catalog. Off by default: the model catalog is
   * never a hard-coded allowlist, and a custom model is a policy exception.
   */
  allowCustomModel: z.boolean().default(false),
});
export type ProviderConnection = z.infer<typeof ProviderConnectionSchema>;

/** A single normalized model offered by a provider connection. */
export const ModelDescriptorSchema = z.object({
  id: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
  description: z.string().trim().default(""),
  contextWindow: z.number().int().nonnegative().nullable().default(null),
  inputModalities: z.array(z.string().trim().min(1)).default([]),
  outputModalities: z.array(z.string().trim().min(1)).default([]),
  supportsStructuredOutput: z.boolean().default(false),
  supportsTools: z.boolean().default(false),
  supportsReasoning: z.boolean().default(false),
  deprecated: z.boolean().default(false),
});
export type ModelDescriptor = z.infer<typeof ModelDescriptorSchema>;

/**
 * Provider-neutral dynamic model catalog.
 *
 * The catalog is always tied to a connection and a provider. Changing provider
 * invalidates the previous catalog and the previous selection, so a catalog can
 * never be read as belonging to a different connection than the one that
 * produced it.
 */
export const ModelCatalogSchema = z.object({
  provider: ProviderIdSchema,
  connectionId: z.string().trim().min(1).max(200),
  fetchedAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  models: z.array(ModelDescriptorSchema).default([]),
});
export type ModelCatalog = z.infer<typeof ModelCatalogSchema>;

/** Distinct catalog conditions the UI must render separately. */
export const ModelCatalogStatusSchema = z.enum([
  "idle",
  "loading",
  "ready",
  "empty",
  "stale",
  "failed",
  "offline",
]);
export type ModelCatalogStatus = z.infer<typeof ModelCatalogStatusSchema>;

/** Empty provider-neutral connection used before any authorization starts. */
export function createDisconnectedConnection(provider: ProviderId): ProviderConnection {
  return ProviderConnectionSchema.parse({
    connectionId: `unconnected:${provider}`,
    provider,
    authMode: provider === "mock" ? "none" : "deploymentManaged",
    status: "disconnected",
  });
}

/**
 * Whether a selected model is usable against a fetched catalog.
 *
 * A selection that exists in the catalog is always valid. A selection absent
 * from the catalog is valid only when it is a policy-permitted custom model,
 * which keeps the catalog a discovery surface rather than an allowlist.
 */
export function isModelSelectable(
  catalog: ModelCatalog | null,
  selectedModel: string | undefined,
  allowCustomModel: boolean,
): boolean {
  if (!selectedModel) return false;
  if (!catalog) return allowCustomModel;
  if (catalog.models.some((model) => model.id === selectedModel)) return true;
  return allowCustomModel;
}

/**
 * Whether a connection's base origin may be used.
 *
 * A policy-rejected origin must never produce a request, even when it was
 * persisted earlier: policy is re-evaluated on read, not trusted from storage.
 */
export function isBaseOriginUsable(baseOrigin: BaseOrigin | undefined): boolean {
  if (!baseOrigin) return true;
  return baseOrigin.classification !== "policyRejected";
}
