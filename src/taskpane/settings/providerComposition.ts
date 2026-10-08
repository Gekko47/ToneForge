/**
 * Provider composition for the task pane (Phase 4, v15 role-aware).
 *
 * Both the Dashboard and the Profile page need an LLM registry built from
 * persisted settings. Centralizing that here means the two call sites cannot
 * drift, and it keeps provider construction out of the React layer entirely:
 * components request a registry, they never build adapters.
 *
 * v15 adds role-aware registry construction: `createRegistryForRole` builds a
 * registry for a specific LLM role (general or consistency_decision) using the
 * role bindings. The legacy `createRegistryFromSettings` is retained for
 * backward compatibility during the transition.
 *
 * The gateway origin is deployment configuration, not a user setting. The
 * user-facing Settings form will stop offering a broker URL field in a later
 * phase of this plan; until then the stored value is only accepted when it
 * resolves to a loopback development origin or a same-origin path, so a
 * production endpoint cannot be introduced through persisted state.
 *
 * Environment-configured timeout and retry values are passed through to the
 * registry so the adapters honour them rather than using hardcoded defaults.
 */

import { createLlmRegistry } from "../../ai/providers/registry";
import type { LlmProvider } from "../../ai/providers/LlmProvider";
import { env } from "../../core/config/env";
import { isProviderAvailable } from "./settingsModel";
import {
  ProviderConnectionSchema,
  type BaseOriginClass,
  type ProviderConnection,
} from "../../core/domain/ProviderConnection";
import type { LlmRole, LlmRoleBindings } from "../../core/domain/LlmRole";
import { normalizeGatewayOrigin } from "../../ai/gateway/gatewayClient";
import type { PersistedState } from "../../core/state/persistence";

type Settings = PersistedState["settings"];
type Connections = PersistedState["providerConnections"];

function classifyOrigin(
  rawOrigin: string,
): { origin: string; classification: BaseOriginClass } | null {
  const normalized = normalizeGatewayOrigin(rawOrigin);
  if (normalized === null) return null;
  const isLoopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/.test(normalized);
  return {
    origin: normalized,
    classification: isLoopback ? "loopbackDevelopment" : "policyAllowed",
  };
}

/**
 * Build the connection record implied by the persisted provider settings.
 *
 * Returns undefined when no remote provider is configured, which is the signal
 * for the registry to stay on the offline mock.
 *
 * v15: This function is retained for the legacy `createRegistryFromSettings`
 * path. New callers should use `connectionForRole` which resolves connections
 * by role binding.
 */
export function connectionFromSettings(
  settings: Settings,
  providerConnections?: Connections,
): ProviderConnection | undefined {
  if (settings.llmProvider === "mock") return undefined;
  /*
   * A provider the deployment cannot reach is refused here rather than at request
   * time, so the registry falls back to the offline mock instead of building an
   * adapter that would fail on first use. Persisted state may still name an
   * unavailable provider: a build can narrow what it offers without a migration
   * (ADR-0060).
   */
  if (!isProviderAvailable(settings.llmProvider)) return undefined;

  // A stored connection is authoritative: it was issued by the gateway, and
  // re-deriving one from the OpenAI-shaped settings fields would discard the
  // connection id the service actually issued. The user's model choice lives in
  // settings rather than in the issued record, so it is merged in — otherwise a
  // gateway-issued connection would silently ignore the model the user picked.
  //
  // v15: providerConnections is keyed by connectionId, not providerId. The
  // legacy lookup finds the first connection matching the provider, which is
  // correct for v14-and-earlier stores that have at most one per provider.
  const stored = findConnectionByProvider(providerConnections, settings.llmProvider);
  if (stored) {
    if (!settings.openAiModel) return stored;
    return ProviderConnectionSchema.parse({ ...stored, selectedModel: settings.openAiModel });
  }

  const rawOrigin = settings.openAiBaseUrl ?? env.LLM_BROKER_URL ?? "";
  const classified = classifyOrigin(rawOrigin);
  if (!classified) return undefined;

  // Only a remote provider reaches this point; `mock` returned above.
  return ProviderConnectionSchema.parse({
    // A stable, non-secret local reference. A production deployment replaces
    // this with the opaque reference the gateway issued.
    connectionId: `local:${settings.llmProvider}:${classified.origin}`,
    provider: settings.llmProvider,
    // OpenRouter is the one remote provider whose credential is a user-held API
    // key, and even that key is submitted to the gateway once and never stored
    // here. The other providers are deployment-managed.
    authMode: settings.llmProvider === "openrouter" ? "brokerApiKey" : "deploymentManaged",
    status: "connected",
    baseOrigin: classified,
    ...(settings.openAiModel ? { selectedModel: settings.openAiModel } : {}),
  });
}

/**
 * Find the first connection matching a provider, for legacy lookups.
 *
 * v15 connections are keyed by connectionId, so there may be multiple
 * connections per provider. This returns the first match, which is correct
 * for v14-and-earlier stores that have at most one per provider.
 */
function findConnectionByProvider(
  connections: Connections,
  provider: string,
): ProviderConnection | undefined {
  if (!connections) return undefined;
  for (const connection of Object.values(connections)) {
    if (connection.provider === provider) return connection;
  }
  return undefined;
}

/**
 * Resolve the connection for a specific LLM role.
 *
 * - `general`: uses the general binding's connectionId.
 * - `consistency_decision`: uses the decision binding's connectionId, or when
 *   `reuseGeneral` is true, the general binding's connectionId (same credential,
 *   different model).
 *
 * Returns undefined when the role is unbound or its connection is missing.
 */
export function connectionForRole(
  role: LlmRole,
  bindings: LlmRoleBindings | undefined,
  connections: Connections,
): ProviderConnection | undefined {
  const binding = bindings?.[role];
  if (!binding) return undefined;

  // When reusing the general connection, resolve via the general binding.
  const effectiveRole: LlmRole =
    role === "consistency_decision" && binding.reuseGeneral ? "general" : role;
  const effectiveBinding = bindings?.[effectiveRole];
  if (!effectiveBinding) return undefined;

  const connection = connections?.[effectiveBinding.connectionId];
  if (!connection) return undefined;

  // Merge the binding's selectedModel so the role's model choice is honoured.
  if (binding.selectedModel) {
    return ProviderConnectionSchema.parse({
      ...connection,
      selectedModel: binding.selectedModel,
    });
  }
  return connection;
}

/**
 * The gateway origin the adapters must be pointed at.
 *
 * This is deployment configuration — the same `LLM_BROKER_URL` the OpenRouter
 * connection settings submit keys to — and never `connection.baseOrigin.origin`,
 * which for a gateway-issued connection is the *upstream provider's* base URL.
 * Using that as the gateway address would send every request straight to the
 * provider instead of through the gateway that holds the credential. A stored
 * broker URL is accepted only as a fallback, and only after the same
 * `normalizeGatewayOrigin` check, so it cannot introduce an arbitrary host.
 */
function gatewayOriginFromSettings(settings: Settings): string {
  return (
    normalizeGatewayOrigin(env.LLM_BROKER_URL) ??
    classifyOrigin(settings.openAiBaseUrl ?? "")?.origin ??
    ""
  );
}

/**
 * Build a registry from persisted settings (legacy, pre-v15).
 *
 * A remote provider is only registered when a usable connection exists, so an
 * unconfigured or policy-refused origin silently falls back to the offline mock
 * rather than failing at request time.
 *
 * @deprecated Use `createRegistryForRole` for new code.
 */
export function createRegistryFromSettings(
  settings: Settings,
  providerConnections?: Connections,
  fetchImpl?: typeof fetch,
): ReturnType<typeof createLlmRegistry> {
  const connection = connectionFromSettings(settings, providerConnections);
  const gatewayBaseUrl = gatewayOriginFromSettings(settings);
  return createLlmRegistry({
    provider: connection ? settings.llmProvider : "mock",
    gatewayBaseUrl,
    ...(connection ? { connection } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
    timeoutMs: env.OPENAI_TIMEOUT_MS,
    maxRetries: env.OPENAI_MAX_RETRIES,
  });
}

/**
 * Build a registry for a specific LLM role.
 *
 * Uses the role binding to resolve the connection and model. When the role is
 * unbound or its connection is missing, falls back to the offline mock.
 *
 * Environment-configured timeout and retry values are passed through.
 */
export function createRegistryForRole(
  role: LlmRole,
  settings: Settings,
  bindings: LlmRoleBindings | undefined,
  connections: Connections,
  fetchImpl?: typeof fetch,
): ReturnType<typeof createLlmRegistry> {
  const connection = connectionForRole(role, bindings, connections);
  if (!connection || connection.status !== "connected") {
    // Unbound or disconnected role: offline mock.
    return createLlmRegistry({
      provider: "mock",
      gatewayBaseUrl: "",
      ...(fetchImpl ? { fetchImpl } : {}),
      timeoutMs: env.OPENAI_TIMEOUT_MS,
      maxRetries: env.OPENAI_MAX_RETRIES,
    });
  }
  const gatewayBaseUrl = gatewayOriginFromSettings(settings);
  return createLlmRegistry({
    provider: connection.provider,
    gatewayBaseUrl,
    connection,
    ...(fetchImpl ? { fetchImpl } : {}),
    timeoutMs: env.OPENAI_TIMEOUT_MS,
    maxRetries: env.OPENAI_MAX_RETRIES,
  });
}

/** Whether a remote provider is currently usable, for UI affordances. */
export function isRemoteProviderConfigured(
  settings: Settings,
  providerConnections?: Connections,
): boolean {
  return connectionFromSettings(settings, providerConnections) !== undefined;
}

/**
 * Whether a specific role has a usable connection.
 *
 * A role is configured when its binding exists, its connection exists in the
 * connections map, and the connection status is `connected`.
 */
export function isRoleConfigured(
  role: LlmRole,
  bindings: LlmRoleBindings | undefined,
  connections: Connections,
): boolean {
  const binding = bindings?.[role];
  if (!binding) return false;
  const effectiveRole: LlmRole =
    role === "consistency_decision" && binding.reuseGeneral ? "general" : role;
  const effectiveBinding = bindings?.[effectiveRole];
  if (!effectiveBinding) return false;
  const connection = connections?.[effectiveBinding.connectionId];
  if (!connection) return false;
  return connection.status === "connected";
}

/**
 * The registry the general role should use.
 *
 * Prefers the v15 general binding. When no general binding exists — a fresh or
 * migrated store the user has not yet bound — falls back to the legacy
 * single-connection path, so an existing configuration keeps working until the
 * user binds the role explicitly in the dashboard.
 */
export function generalRegistryFromState(
  state: PersistedState,
  fetchImpl?: typeof fetch,
): ReturnType<typeof createLlmRegistry> {
  const bindings = state.llmRoleBindings;
  if (bindings?.general) {
    return createRegistryForRole(
      "general",
      state.settings,
      bindings,
      state.providerConnections,
      fetchImpl,
    );
  }
  return createRegistryFromSettings(state.settings, state.providerConnections, fetchImpl);
}

/**
 * The general role's provider, or undefined when it resolves to the offline
 * mock (unbound, disconnected, or policy-refused).
 */
export function generalProviderFromState(
  state: PersistedState,
  fetchImpl?: typeof fetch,
): LlmProvider | undefined {
  const registry = generalRegistryFromState(state, fetchImpl);
  return registry.activeName === "mock" ? undefined : registry.activeProvider;
}

/**
 * The decision role's provider, or undefined when it is unbound.
 *
 * No legacy fallback: the decision role is new in v15 and has no pre-v15
 * equivalent. An unbound decision role is undefined, and the engine's
 * `decisionFallbackPolicy` decides what happens to the unresolved residue.
 */
export function decisionProviderFromState(
  state: PersistedState,
  fetchImpl?: typeof fetch,
): LlmProvider | undefined {
  const bindings = state.llmRoleBindings;
  if (!bindings?.consistency_decision) return undefined;
  const registry = createRegistryForRole(
    "consistency_decision",
    state.settings,
    bindings,
    state.providerConnections,
    fetchImpl,
  );
  return registry.activeName === "mock" ? undefined : registry.activeProvider;
}

/** The general role's model, for provenance. Falls back to the legacy model. */
export function generalModelFromState(state: PersistedState): string | undefined {
  return state.llmRoleBindings?.general?.selectedModel ?? state.settings.openAiModel;
}

/** The decision role's model, for provenance. */
export function decisionModelFromState(state: PersistedState): string | undefined {
  return state.llmRoleBindings?.consistency_decision?.selectedModel;
}

/**
 * Whether the general role has a usable connection, for UI affordances.
 *
 * Role-aware when a general binding exists; otherwise the legacy check, so the
 * affordance matches whichever path the run will actually take.
 */
export function isGeneralRoleConfigured(state: PersistedState): boolean {
  const bindings = state.llmRoleBindings;
  if (bindings?.general) {
    return isRoleConfigured("general", bindings, state.providerConnections);
  }
  return isRemoteProviderConfigured(state.settings, state.providerConnections);
}

/** Whether the decision role has a usable connection, for UI affordances. */
export function isDecisionRoleConfigured(state: PersistedState): boolean {
  return isRoleConfigured("consistency_decision", state.llmRoleBindings, state.providerConnections);
}
