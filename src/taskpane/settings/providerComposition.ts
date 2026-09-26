/**
 * Provider composition for the task pane (Phase 4).
 *
 * Both the Dashboard and the Profile page need an LLM registry built from
 * persisted settings. Centralizing that here means the two call sites cannot
 * drift, and it keeps provider construction out of the React layer entirely:
 * components request a registry, they never build adapters.
 *
 * The gateway origin is deployment configuration, not a user setting. The
 * user-facing Settings form will stop offering a broker URL field in a later
 * phase of this plan; until then the stored value is only accepted when it
 * resolves to a loopback development origin or a same-origin path, so a
 * production endpoint cannot be introduced through persisted state.
 */

import { createLlmRegistry } from "../../ai/providers/registry";
import { env } from "../../core/config/env";
import {
  ProviderConnectionSchema,
  type BaseOriginClass,
  type ProviderConnection,
} from "../../core/domain/ProviderConnection";
import { normalizeGatewayOrigin } from "../../ai/gateway/gatewayClient";
import type { PersistedState } from "../../core/state/persistence";

type Settings = PersistedState["settings"];

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
 */
export function connectionFromSettings(
  settings: Settings,
  providerConnections?: PersistedState["providerConnections"],
): ProviderConnection | undefined {
  if (settings.llmProvider === "mock") return undefined;

  // A stored connection is authoritative: it was issued by the gateway, and
  // re-deriving one from the OpenAI-shaped settings fields would discard the
  // connection id the service actually issued. The user's model choice lives in
  // settings rather than in the issued record, so it is merged in — otherwise a
  // gateway-issued connection would silently ignore the model the user picked.
  const stored = providerConnections?.[settings.llmProvider];
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
 * Build a registry from persisted settings.
 *
 * A remote provider is only registered when a usable connection exists, so an
 * unconfigured or policy-refused origin silently falls back to the offline mock
 * rather than failing at request time.
 */
export function createRegistryFromSettings(
  settings: Settings,
  providerConnections?: PersistedState["providerConnections"],
  fetchImpl?: typeof fetch,
): ReturnType<typeof createLlmRegistry> {
  const connection = connectionFromSettings(settings, providerConnections);
  const gatewayBaseUrl = gatewayOriginFromSettings(settings);
  return createLlmRegistry({
    provider: connection ? settings.llmProvider : "mock",
    gatewayBaseUrl,
    ...(connection ? { connection } : {}),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

/** Whether a remote provider is currently usable, for UI affordances. */
export function isRemoteProviderConfigured(
  settings: Settings,
  providerConnections?: PersistedState["providerConnections"],
): boolean {
  return connectionFromSettings(settings, providerConnections) !== undefined;
}
