/**
 * Provider registry: selects the active adapter and exposes a single
 * interface for semantic analysis.
 */

import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./LlmProvider";
import { OpenAiAdapter } from "./openaiAdapter";
import { MockAdapter } from "./mockAdapter";
import { withSemanticHelpers, type LlmSemanticProvider } from "./LlmProvider";

export type ProviderName = "openai" | "mock";

export interface LlmRegistryOptions {
  provider?: ProviderName;
  openai?: ConstructorParameters<typeof OpenAiAdapter>[0];
  mock?: ConstructorParameters<typeof MockAdapter>[0];
}

export class LlmRegistry {
  private readonly providers: Map<string, LlmProvider>;
  private active: LlmProvider;

  constructor(opts: LlmRegistryOptions = {}) {
    this.providers = new Map();
    const openai = new OpenAiAdapter(opts.openai ?? {});
    this.providers.set("openai", openai);
    this.providers.set("mock", new MockAdapter(opts.mock ?? {}));

    // Default to mock when no API key is configured, so the add-in is
    // functional offline and never throws on missing configuration.
    if (opts.provider) {
      this.active = this.providers.get(opts.provider) ?? this.providers.get("openai")!;
    } else if (openai.configured) {
      this.active = openai;
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

  switch(name: ProviderName): void {
    const p = this.providers.get(name);
    if (!p) throw new LlmError(`Unknown provider: ${name}`, name, false);
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
      this.active = this.providers.get(fallback)!;
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
