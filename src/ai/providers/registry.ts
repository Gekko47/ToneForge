/**
 * Provider registry: selects the active adapter and exposes a single
 * interface for semantic analysis.
 *
 * Remote providers are constructed from a gateway-issued connection reference.
 * A provider with no usable connection is not registered as selectable, so the
 * registry cannot silently fall back to a partially configured adapter.
 */

import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./LlmProvider";
import { OpenAiAdapter } from "./openaiAdapter";
import { AnthropicAdapter } from "./anthropicAdapter";
import { OpenRouterAdapter } from "./openRouterAdapter";
import { MockAdapter } from "./mockAdapter";
import { withSemanticHelpers, type LlmSemanticProvider } from "./LlmProvider";
import {
  createDisconnectedConnection,
  type ProviderConnection,
  type ProviderId,
} from "../../core/domain/ProviderConnection";

export type ProviderName = ProviderId;

/** A gateway-issued connection for the active remote provider, if any. */
export interface LlmRegistryOptions {
  provider?: ProviderName;
  /** Deployment-configured gateway origin used by remote adapters. */
  gatewayBaseUrl?: string;
  connection?: ProviderConnection;
  mock?: ConstructorParameters<typeof MockAdapter>[0];
  fetchImpl?: typeof fetch;
}

function disconnectedFor(provider: ProviderId): ProviderConnection {
  return createDisconnectedConnection(provider);
}

export class LlmRegistry {
  private readonly providers: Map<string, LlmProvider>;
  private active: LlmProvider;

  constructor(opts: LlmRegistryOptions = {}) {
    this.providers = new Map();
    const gatewayBaseUrl = opts.gatewayBaseUrl ?? "";
    const connection = opts.connection;

    // A remote adapter is only registered when it is actually usable. This is
    // what keeps an unconnected or policy-rejected provider from being selected
    // and failing at request time.
    const openai =
      connection?.provider === "openai"
        ? new OpenAiAdapter({
            gatewayBaseUrl,
            connection,
            ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
          })
        : null;
    const anthropic =
      connection?.provider === "anthropic"
        ? new AnthropicAdapter({
            gatewayBaseUrl,
            connection,
            ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
          })
        : null;
    const openrouter =
      connection?.provider === "openrouter"
        ? new OpenRouterAdapter({
            gatewayBaseUrl,
            connection,
            ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
          })
        : null;

    if (openai) this.providers.set("openai", openai);
    if (anthropic) this.providers.set("anthropic", anthropic);
    if (openrouter) this.providers.set("openrouter", openrouter);
    this.providers.set("mock", new MockAdapter(opts.mock ?? {}));

    // An explicit provider request is honoured only when that provider is
    // registered. Otherwise the connected provider is the default, because the
    // caller has already established a usable connection. With neither, the
    // offline mock is used, which always works.
    const requested = opts.provider ?? connection?.provider;
    if (requested && this.providers.has(requested)) {
      this.active = this.providers.get(requested)!;
    } else {
      this.active = this.providers.get("mock")!;
    }
  }

  get activeProvider(): LlmProvider {
    return this.active;
  }

  get activeName(): string {
    return this.active.name;
  }

  /** Providers that can currently be selected. */
  availableProviders(): ProviderName[] {
    return [...this.providers.keys()] as ProviderName[];
  }

  switch(name: ProviderName): void {
    const p = this.providers.get(name);
    if (!p) throw new LlmError(`Unknown or unavailable provider: ${name}`, name, false);
    this.active = p;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    return this.active.complete(request);
  }

  async completeWithFallback(
    request: LlmRequest,
    fallback: ProviderName = "mock",
  ): Promise<LlmResponse> {
    try {
      return await this.complete(request);
    } catch (err) {
      if (this.active.name === fallback) throw err;
      const previous = this.active;
      const target = this.providers.get(fallback);
      if (!target) throw err;
      this.active = target;
      try {
        return await this.complete(request);
      } finally {
        this.active = previous;
      }
    }
  }
}

/** Build a registry with semantic helpers attached. */
export function createLlmRegistry(
  opts: LlmRegistryOptions = {},
): LlmRegistry & LlmSemanticProvider {
  const registry = new LlmRegistry(opts);
  return withSemanticHelpers(registry as LlmRegistry & LlmProvider);
}

/** Exported for tests that need a disconnected record for a provider. */
export { disconnectedFor };
