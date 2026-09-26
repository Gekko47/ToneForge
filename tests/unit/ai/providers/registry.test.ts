import { describe, expect, it, vi } from "vitest";
import { LlmRegistry, createLlmRegistry } from "../../../../src/ai/providers/registry";
import { LlmError } from "../../../../src/ai/providers/LlmProvider";
import { ProviderConnectionSchema } from "../../../../src/core/domain/ProviderConnection";

const GATEWAY = "https://localhost:3000";

function connection(provider: "openai" | "anthropic" | "openrouter", overrides = {}) {
  return ProviderConnectionSchema.parse({
    connectionId: `conn_${provider}`,
    provider,
    authMode: provider === "openrouter" ? "brokerApiKey" : "deploymentManaged",
    status: "connected",
    ...overrides,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: async () => body,
  } as unknown as Response;
}

const okFetch = vi.fn(async () =>
  jsonResponse({ choices: [{ message: { content: "ok" } }], model: "m" }),
) as unknown as typeof fetch;

describe("LlmRegistry", () => {
  it("defaults to the offline mock when no connection is configured", () => {
    const registry = new LlmRegistry();
    expect(registry.activeName).toBe("mock");
    expect(registry.availableProviders()).toEqual(["mock"]);
  });

  it("registers only the connected provider, not every named provider", () => {
    const registry = new LlmRegistry({
      gatewayBaseUrl: GATEWAY,
      connection: connection("anthropic"),
    });
    // Registering an unconnected provider would let it be selected and then
    // fail at request time.
    expect(registry.availableProviders()).toEqual(["anthropic", "mock"]);
  });

  it("activates the connected provider when one is supplied", () => {
    const registry = new LlmRegistry({
      gatewayBaseUrl: GATEWAY,
      connection: connection("openrouter"),
      fetchImpl: okFetch,
    });
    expect(registry.activeName).toBe("openrouter");
  });

  it("falls back to the offline mock when the requested provider is unavailable", () => {
    // An explicit request for a provider that is not connected must not be
    // silently satisfied by a different one: the user asked for OpenAI, so
    // falling back to the offline mock is the honest outcome.
    const registry = new LlmRegistry({
      provider: "openai",
      gatewayBaseUrl: GATEWAY,
      connection: connection("anthropic"),
    });
    expect(registry.activeName).toBe("mock");
  });

  it("refuses to switch to an unregistered provider", () => {
    const registry = new LlmRegistry({ gatewayBaseUrl: GATEWAY, connection: connection("openai") });
    expect(() => registry.switch("openrouter")).toThrow(LlmError);
  });

  it("switches between the connected provider and the offline mock", () => {
    const registry = new LlmRegistry({ gatewayBaseUrl: GATEWAY, connection: connection("openai") });
    registry.switch("mock");
    expect(registry.activeName).toBe("mock");
    registry.switch("openai");
    expect(registry.activeName).toBe("openai");
  });

  it("refuses a request through a connection that is not ready", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: "ok" } }] }),
    ) as unknown as typeof fetch;
    const registry = new LlmRegistry({
      gatewayBaseUrl: GATEWAY,
      connection: connection("openai", { status: "disconnected" }),
      fetchImpl,
    });
    // The provider is a known provider, so it is registered and selected, but
    // the adapter refuses the request before touching the network.
    await expect(registry.complete({ prompt: "hi" })).rejects.toThrow(LlmError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to the offline mock when the active provider fails", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const registry = new LlmRegistry({
      gatewayBaseUrl: GATEWAY,
      connection: connection("openai"),
      fetchImpl: failing,
      mock: { defaultResponse: "offline answer" },
    });
    const result = await registry.completeWithFallback({ prompt: "hi" });
    expect(result.text).toBe("offline answer");
  });

  it("restores the previous active provider after a fallback", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const registry = new LlmRegistry({
      gatewayBaseUrl: GATEWAY,
      connection: connection("openai"),
      fetchImpl: failing,
      mock: { defaultResponse: "offline" },
    });
    await registry.completeWithFallback({ prompt: "hi" });
    expect(registry.activeName).toBe("openai");
  });

  it("propagates the failure when the fallback is the active provider", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    const registry = new LlmRegistry({ fetchImpl: failing, mock: { failOn: ["hi"] } });
    await expect(registry.completeWithFallback({ prompt: "hi" })).rejects.toThrow();
  });
});

describe("createLlmRegistry", () => {
  it("attaches the semantic helpers", async () => {
    const registry = createLlmRegistry({ mock: { defaultResponse: "profiled" } });
    expect(typeof registry.profile).toBe("function");
    expect(typeof registry.deviations).toBe("function");
    expect(typeof registry.rewrite).toBe("function");
    const result = await registry.profile({ prompt: "hi" });
    expect(result.text).toBe("profiled");
  });
});
