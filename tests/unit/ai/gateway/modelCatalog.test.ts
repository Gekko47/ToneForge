import { describe, expect, it } from "vitest";
import {
  invalidateCatalogOnProviderChange,
  isCatalogForConnection,
  normalizeAnthropicModel,
  normalizeModelCatalog,
  normalizeOpenAiModel,
  normalizeOpenRouterModel,
  resolveCatalogStatus,
} from "../../../../src/ai/gateway/modelCatalog";
import {
  ProviderConnectionSchema,
  type ProviderConnection,
} from "../../../../src/core/domain/ProviderConnection";

const NOW = "2026-09-26T12:00:00.000Z";

/**
 * Trimmed from the documented OpenRouter `GET /api/v1/models` response, so the
 * mapper is tested against the real field names rather than an invented shape.
 */
const OPENROUTER_PAYLOAD = {
  data: [
    {
      id: "anthropic/claude-sonnet-4",
      name: "Anthropic: Claude Sonnet 4",
      created: 1690502400,
      description: "Anthropic's flagship model.",
      context_length: 1000000,
      top_provider: { context_length: 128000, max_completion_tokens: 4096 },
      architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      supported_parameters: ["tools", "temperature", "structured_outputs", "reasoning"],
      expiration_date: null,
    },
    {
      id: "google/gemini-2.5-pro-preview",
      name: "Gemini 2.5 Pro Preview",
      context_length: 1000000,
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["temperature"],
      expiration_date: "2026-12-01T00:00:00Z",
    },
  ],
  total_count: 2,
  links: { next: null },
};

function openRouterCatalog() {
  return normalizeModelCatalog(OPENROUTER_PAYLOAD, {
    provider: "openrouter",
    connectionId: "conn_or",
    fetchedAt: NOW,
  });
}

describe("normalizeOpenRouterModel", () => {
  it("maps the documented OpenRouter fields onto the neutral descriptor", () => {
    const model = normalizeOpenRouterModel(OPENROUTER_PAYLOAD.data[0] as Record<string, unknown>);
    expect(model?.id).toBe("anthropic/claude-sonnet-4");
    expect(model?.displayName).toBe("Anthropic: Claude Sonnet 4");
    expect(model?.inputModalities).toEqual(["text", "image"]);
    expect(model?.outputModalities).toEqual(["text"]);
  });

  it("reads capability flags from supported_parameters", () => {
    const model = normalizeOpenRouterModel(OPENROUTER_PAYLOAD.data[0] as Record<string, unknown>);
    expect(model?.supportsTools).toBe(true);
    expect(model?.supportsStructuredOutput).toBe(true);
    expect(model?.supportsReasoning).toBe(true);
  });

  it("prefers the enforced top_provider context limit over the advertised one", () => {
    // Advertising 1,000,000 when the provider enforces 128,000 would let the UI
    // promise a context window the request cannot use.
    const model = normalizeOpenRouterModel(OPENROUTER_PAYLOAD.data[0] as Record<string, unknown>);
    expect(model?.contextWindow).toBe(128000);
  });

  it("falls back to the advertised context length when no enforced limit exists", () => {
    const model = normalizeOpenRouterModel(OPENROUTER_PAYLOAD.data[1] as Record<string, unknown>);
    expect(model?.contextWindow).toBe(1000000);
  });

  it("marks a model with an expiry date as deprecated", () => {
    const model = normalizeOpenRouterModel(OPENROUTER_PAYLOAD.data[1] as Record<string, unknown>);
    expect(model?.deprecated).toBe(true);
  });

  it("does not mark a model with a null expiry as deprecated", () => {
    const model = normalizeOpenRouterModel(OPENROUTER_PAYLOAD.data[0] as Record<string, unknown>);
    expect(model?.deprecated).toBe(false);
  });

  it("returns null for an entry with no usable id rather than inventing one", () => {
    expect(normalizeOpenRouterModel({ name: "No id here" })).toBeNull();
    expect(normalizeOpenRouterModel({ id: "   " })).toBeNull();
  });

  it("falls back to the id when a name is absent", () => {
    expect(normalizeOpenRouterModel({ id: "vendor/minimal" })?.displayName).toBe("vendor/minimal");
  });
});

describe("normalizeModelCatalog", () => {
  it("normalizes an OpenRouter list and sorts it deterministically", () => {
    const catalog = openRouterCatalog();
    expect(catalog.provider).toBe("openrouter");
    expect(catalog.connectionId).toBe("conn_or");
    expect(catalog.models.map((model) => model.id)).toEqual([
      "anthropic/claude-sonnet-4",
      "google/gemini-2.5-pro-preview",
    ]);
  });

  it("drops unusable entries but keeps the rest of the list", () => {
    const catalog = normalizeModelCatalog(
      { data: [{ id: "good/model" }, { name: "broken" }] },
      { provider: "openrouter", connectionId: "conn_or", fetchedAt: NOW },
    );
    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0]?.id).toBe("good/model");
  });

  it("produces an empty catalog for an unreadable payload instead of throwing", () => {
    const catalog = normalizeModelCatalog("not an object", {
      provider: "openrouter",
      connectionId: "conn_or",
      fetchedAt: NOW,
    });
    expect(catalog.models).toEqual([]);
  });

  it("produces an empty catalog when the provider returned no data array", () => {
    const catalog = normalizeModelCatalog(
      {},
      {
        provider: "openrouter",
        connectionId: "conn_or",
        fetchedAt: NOW,
      },
    );
    expect(catalog.models).toEqual([]);
  });

  it("normalizes an OpenAI list shape", () => {
    const catalog = normalizeModelCatalog(
      { data: [{ id: "gpt-4o-mini", context_window: 128000, supported_tools: true }] },
      { provider: "openai", connectionId: "conn_oa", fetchedAt: NOW },
    );
    expect(catalog.models[0]?.contextWindow).toBe(128000);
    expect(catalog.models[0]?.supportsTools).toBe(true);
  });

  it("normalizes an Anthropic list shape", () => {
    const catalog = normalizeModelCatalog(
      { data: [{ id: "claude-x", display_name: "Claude X" }] },
      { provider: "anthropic", connectionId: "conn_an", fetchedAt: NOW },
    );
    expect(catalog.models[0]?.displayName).toBe("Claude X");
  });

  it("returns no models for the offline provider, whose list is not fetched", () => {
    const catalog = normalizeModelCatalog(
      { data: [{ id: "whatever" }] },
      { provider: "mock", connectionId: "conn_mock", fetchedAt: NOW },
    );
    expect(catalog.models).toEqual([]);
  });

  it("retains an expiry when one is supplied", () => {
    const catalog = normalizeModelCatalog(
      { data: [] },
      {
        provider: "openrouter",
        connectionId: "conn_or",
        fetchedAt: NOW,
        expiresAt: "2026-09-26T13:00:00.000Z",
      },
    );
    expect(catalog.expiresAt).toBe("2026-09-26T13:00:00.000Z");
  });
});

describe("normalizeOpenAiModel / normalizeAnthropicModel", () => {
  it("drop entries with no id", () => {
    expect(normalizeOpenAiModel({})).toBeNull();
    expect(normalizeAnthropicModel({})).toBeNull();
  });
});

describe("resolveCatalogStatus", () => {
  const base = { loading: false, offline: false, failed: false, now: new Date(NOW) };

  it("reports loading while a fetch is in flight", () => {
    expect(resolveCatalogStatus({ ...base, loading: true, catalog: openRouterCatalog() })).toBe(
      "loading",
    );
  });

  it("distinguishes an empty provider list from a failure", () => {
    const empty = normalizeModelCatalog(
      { data: [] },
      {
        provider: "openrouter",
        connectionId: "conn_or",
        fetchedAt: NOW,
      },
    );
    expect(resolveCatalogStatus({ ...base, catalog: empty })).toBe("empty");
    expect(resolveCatalogStatus({ ...base, catalog: openRouterCatalog(), failed: true })).toBe(
      "failed",
    );
  });

  it("distinguishes offline from idle", () => {
    expect(resolveCatalogStatus({ ...base, catalog: null, offline: true })).toBe("offline");
    expect(resolveCatalogStatus({ ...base, catalog: null })).toBe("idle");
  });

  it("reports stale when the catalog has expired", () => {
    const expiring = normalizeModelCatalog(
      { data: [{ id: "a/b" }] },
      {
        provider: "openrouter",
        connectionId: "conn_or",
        fetchedAt: NOW,
        expiresAt: "2026-09-26T11:00:00.000Z",
      },
    );
    expect(resolveCatalogStatus({ ...base, catalog: expiring })).toBe("stale");
  });

  it("reports ready for a populated, unexpired catalog", () => {
    expect(resolveCatalogStatus({ ...base, catalog: openRouterCatalog() })).toBe("ready");
  });
});

describe("catalog ownership and invalidation", () => {
  function connection(provider: "openrouter" | "openai" = "openrouter"): ProviderConnection {
    return ProviderConnectionSchema.parse({
      connectionId: "conn_or",
      provider,
      authMode: "brokerApiKey",
      status: "connected",
    });
  }

  it("accepts a catalog that belongs to the current connection", () => {
    expect(isCatalogForConnection(openRouterCatalog(), connection())).toBe(true);
  });

  it("rejects a catalog fetched for a different connection", () => {
    const other = ProviderConnectionSchema.parse({
      connectionId: "conn_other",
      provider: "openrouter",
      authMode: "brokerApiKey",
      status: "connected",
    });
    expect(isCatalogForConnection(openRouterCatalog(), other)).toBe(false);
  });

  it("invalidates the previous provider's catalog when the provider changes", () => {
    expect(invalidateCatalogOnProviderChange(openRouterCatalog(), "openai")).toBeNull();
  });

  it("keeps the catalog when the provider is unchanged", () => {
    const catalog = openRouterCatalog();
    expect(invalidateCatalogOnProviderChange(catalog, "openrouter")).toBe(catalog);
  });

  it("treats a missing catalog as nothing to invalidate", () => {
    expect(invalidateCatalogOnProviderChange(null, "openai")).toBeNull();
  });
});
