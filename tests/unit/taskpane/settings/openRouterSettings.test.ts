import { describe, expect, it } from "vitest";
import {
  buildModelOptions,
  isSelectableModel,
  OPENROUTER_DEFAULT_BASE_URL,
  PROVIDER_OPTIONS,
  providerAcceptsUserApiKey,
  providerOption,
  validateApiKeyInput,
  validateOpenRouterBaseUrl,
} from "../../../../src/taskpane/settings/settingsModel";
import type { ModelCatalog, ModelDescriptor } from "../../../../src/core/domain/index";

function model(overrides: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return {
    id: "openai/gpt-4o-mini",
    displayName: "GPT-4o mini",
    description: "",
    contextWindow: 128_000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsStructuredOutput: true,
    supportsTools: true,
    supportsReasoning: false,
    deprecated: false,
    ...overrides,
  };
}

function catalog(models: ModelDescriptor[]): ModelCatalog {
  return {
    provider: "openrouter",
    connectionId: "or_abc",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T01:00:00.000Z",
    models,
  };
}

describe("provider options", () => {
  it("offers all four providers", () => {
    expect(PROVIDER_OPTIONS.map((option) => option.key)).toEqual([
      "mock",
      "openai",
      "anthropic",
      "openrouter",
    ]);
  });

  it("gives every provider an auth note so custody is never ambiguous", () => {
    PROVIDER_OPTIONS.forEach((option) => {
      expect(option.authNote.length).toBeGreaterThan(0);
    });
  });

  it("describes the offline stub as making no network call", () => {
    expect(providerOption("mock").authNote).toMatch(/no network call/i);
  });

  it("tells the user exactly what happens to an OpenRouter key", () => {
    expect(providerOption("openrouter").authNote).toMatch(/not stored/i);
  });

  it("falls back to the offline stub for an unrecognized provider", () => {
    // Fail closed: an unknown key must never resolve to a remote provider's
    // description, which would imply a working connection that does not exist.
    expect(providerOption("gemini" as never).key).toBe("mock");
  });

  it("offers a user-held key only for OpenRouter", () => {
    expect(providerAcceptsUserApiKey("openrouter")).toBe(true);
    expect(providerAcceptsUserApiKey("openai")).toBe(false);
    expect(providerAcceptsUserApiKey("anthropic")).toBe(false);
    expect(providerAcceptsUserApiKey("mock")).toBe(false);
  });
});

describe("validateOpenRouterBaseUrl", () => {
  it("accepts the default OpenRouter endpoint", () => {
    expect(validateOpenRouterBaseUrl(OPENROUTER_DEFAULT_BASE_URL)).toBeNull();
  });

  it("defaults to the real OpenRouter API root", () => {
    // Verified against the live OpenRouter API: the base is openrouter.ai/api/v1
    // and the model list lives at GET /models relative to it.
    expect(OPENROUTER_DEFAULT_BASE_URL).toBe("https://openrouter.ai/api/v1");
  });

  it("accepts another HTTPS endpoint for a self-hosted compatible server", () => {
    expect(validateOpenRouterBaseUrl("https://llm.internal.example/v1")).toBeNull();
  });

  it("rejects an empty value", () => {
    expect(validateOpenRouterBaseUrl("   ")).toMatch(/required/i);
  });

  it("rejects plain HTTP", () => {
    // The gateway will forward the key to this address, so plaintext transport
    // to the credential holder is not acceptable.
    expect(validateOpenRouterBaseUrl("http://openrouter.ai/api/v1")).toMatch(/HTTPS/i);
  });

  it("rejects a URL with embedded credentials", () => {
    expect(validateOpenRouterBaseUrl("https://user:pass@openrouter.ai/api/v1")).toMatch(
      /credentials/i,
    );
  });

  it("rejects a URL carrying a key in its query string", () => {
    expect(validateOpenRouterBaseUrl("https://openrouter.ai/api/v1?key=sk-secret")).toMatch(
      /query/i,
    );
  });

  it("rejects a fragment", () => {
    expect(validateOpenRouterBaseUrl("https://openrouter.ai/api/v1#frag")).toMatch(/fragment/i);
  });

  it("rejects text that is not a URL", () => {
    expect(validateOpenRouterBaseUrl("not a url")).toMatch(/valid URL/i);
  });
});

describe("validateApiKeyInput", () => {
  it("accepts a plausible key", () => {
    expect(validateApiKeyInput("sk-or-v1-0123456789abcdefghij")).toBeNull();
  });

  it("trims surrounding whitespace before judging", () => {
    expect(validateApiKeyInput("  sk-or-v1-0123456789abcdefghij  ")).toBeNull();
  });

  it("rejects an empty key", () => {
    expect(validateApiKeyInput("")).toMatch(/required/i);
  });

  it("rejects an internal space, which a pasted key often carries", () => {
    expect(validateApiKeyInput("sk-or-v1 0123456789abcdefghij")).toMatch(/whitespace/i);
  });

  it("rejects a fragment too short to be a key", () => {
    expect(validateApiKeyInput("sk-or")).toMatch(/complete/i);
  });
});

describe("buildModelOptions", () => {
  it("uses the display name and keeps the id in the detail line", () => {
    const [option] = buildModelOptions([model()]);
    expect(option?.key).toBe("openai/gpt-4o-mini");
    expect(option?.text).toBe("GPT-4o mini");
    expect(option?.detail).toContain("openai/gpt-4o-mini");
  });

  it("surfaces the context window so a user can judge the trade-off", () => {
    const [option] = buildModelOptions([model({ contextWindow: 200_000 })]);
    expect(option?.detail).toContain("200k ctx");
  });

  it("omits the context figure when the provider does not report one", () => {
    const [option] = buildModelOptions([model({ contextWindow: null })]);
    expect(option?.detail).not.toMatch(/ctx/);
  });

  it("lists capability flags the provider advertised", () => {
    const [option] = buildModelOptions([
      model({ supportsTools: true, supportsStructuredOutput: true, supportsReasoning: true }),
    ]);
    expect(option?.detail).toContain("tools");
    expect(option?.detail).toContain("structured");
    expect(option?.detail).toContain("reasoning");
  });

  it("labels a deprecated model rather than hiding it", () => {
    // A user's saved selection may name a deprecated model. Removing it would
    // make that configuration look like it had silently vanished.
    const [option] = buildModelOptions([model({ deprecated: true })]);
    expect(option?.text).toMatch(/deprecated/i);
  });

  it("sorts deprecated models last", () => {
    const options = buildModelOptions([
      model({ id: "z/live", deprecated: false }),
      model({ id: "a/dead", deprecated: true }),
    ]);
    expect(options.map((option) => option.key)).toEqual(["z/live", "a/dead"]);
  });

  it("sorts live models by id for a stable list", () => {
    const options = buildModelOptions([
      model({ id: "vendor/zeta" }),
      model({ id: "vendor/alpha" }),
    ]);
    expect(options.map((option) => option.key)).toEqual(["vendor/alpha", "vendor/zeta"]);
  });

  it("returns nothing for an empty catalog", () => {
    expect(buildModelOptions([])).toEqual([]);
  });
});

describe("isSelectableModel", () => {
  it("accepts a model the catalog offers", () => {
    const source = catalog([model()]);
    expect(isSelectableModel(source, "openai/gpt-4o-mini", buildModelOptions(source.models))).toBe(
      true,
    );
  });

  it("rejects a model the catalog does not offer", () => {
    const source = catalog([model()]);
    expect(isSelectableModel(source, "openai/nope", buildModelOptions(source.models))).toBe(false);
  });

  it("rejects every model when no catalog has loaded", () => {
    expect(isSelectableModel(null, "openai/gpt-4o-mini", [])).toBe(false);
  });
});
