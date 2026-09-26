import { describe, expect, it, vi } from "vitest";
import {
  AnthropicAdapter,
  createAnthropicConnection,
} from "../../../../src/ai/providers/anthropicAdapter";
import {
  OpenRouterAdapter,
  createOpenRouterConnection,
} from "../../../../src/ai/providers/openRouterAdapter";
import { LlmError } from "../../../../src/ai/providers/LlmProvider";
import { ProviderConnectionSchema } from "../../../../src/core/domain/ProviderConnection";

const GATEWAY = "https://localhost:3000";

function connection(provider: "anthropic" | "openrouter", overrides = {}) {
  return ProviderConnectionSchema.parse({
    connectionId: `conn_${provider}`,
    provider,
    authMode: provider === "openrouter" ? "brokerApiKey" : "oauth",
    status: "connected",
    ...overrides,
  });
}

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string, init: RequestInit) =>
    handler(url, init),
  ) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: async () => body,
  } as unknown as Response;
}

describe("AnthropicAdapter", () => {
  it("routes to the gateway connection", async () => {
    let seenUrl = "";
    const fetchImpl = mockFetch((url) => {
      seenUrl = url;
      return jsonResponse({ content: [{ type: "text", text: "hi" }] });
    });
    await new AnthropicAdapter({
      gatewayBaseUrl: GATEWAY,
      connection: connection("anthropic"),
      fetchImpl,
    }).complete({ prompt: "hi" });
    expect(seenUrl).toBe(`${GATEWAY}/v1/connections/conn_anthropic/chat/completions`);
  });

  it("sends the system prompt as a top-level field, not as a system message", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = mockFetch((_url, init) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse({ content: [{ type: "text", text: "ok" }] });
    });
    await new AnthropicAdapter({
      gatewayBaseUrl: GATEWAY,
      connection: connection("anthropic"),
      fetchImpl,
    }).complete({ prompt: "user text", systemPrompt: "system rules" });
    expect(body.system).toBe("system rules");
    expect(body.messages).toEqual([{ role: "user", content: "user text" }]);
  });

  it("concatenates text blocks from the content array", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({
        content: [
          { type: "text", text: "first " },
          { type: "text", text: "second" },
        ],
        model: "claude-x",
      }),
    );
    const result = await new AnthropicAdapter({
      gatewayBaseUrl: GATEWAY,
      connection: connection("anthropic"),
      fetchImpl,
    }).complete({ prompt: "hi" });
    expect(result.text).toBe("first second");
  });

  it("normalizes Anthropic token usage into the provider-agnostic shape", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({
        content: [{ type: "text", text: "ok" }],
        model: "claude-x",
        usage: { input_tokens: 5, output_tokens: 9 },
      }),
    );
    const result = await new AnthropicAdapter({
      gatewayBaseUrl: GATEWAY,
      connection: connection("anthropic"),
      fetchImpl,
    }).complete({ prompt: "hi" });
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 9 });
  });

  it("never sends an Authorization header", async () => {
    let headers: Record<string, string> = {};
    const fetchImpl = mockFetch((_url, init) => {
      headers = init.headers as Record<string, string>;
      return jsonResponse({ content: [] });
    });
    await new AnthropicAdapter({
      gatewayBaseUrl: GATEWAY,
      connection: connection("anthropic"),
      fetchImpl,
    }).complete({ prompt: "hi" });
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain("authorization");
  });

  it("refuses when the connection is not ready", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}));
    const error = (await new AnthropicAdapter({
      gatewayBaseUrl: GATEWAY,
      connection: connection("anthropic", { status: "reconnectRequired" }),
      fetchImpl,
    })
      .complete({ prompt: "hi" })
      .catch((err: unknown) => err)) as LlmError;
    expect(error).toBeInstanceOf(LlmError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("createAnthropicConnection", () => {
  it("builds an OAuth-mode record", () => {
    expect(createAnthropicConnection("conn_1").authMode).toBe("oauth");
  });

  it("has no credential-capable field", () => {
    const forbidden = /key|token|secret|password/i;
    expect(
      Object.keys(createAnthropicConnection("conn_1")).filter((k) => forbidden.test(k)),
    ).toEqual([]);
  });
});

describe("OpenRouterAdapter", () => {
  it("routes to the gateway connection", async () => {
    let seenUrl = "";
    const fetchImpl = mockFetch((url) => {
      seenUrl = url;
      return jsonResponse({ choices: [{ message: { content: "hi" } }] });
    });
    await new OpenRouterAdapter({
      gatewayBaseUrl: GATEWAY,
      connection: connection("openrouter"),
      fetchImpl,
    }).complete({ prompt: "hi" });
    expect(seenUrl).toBe(`${GATEWAY}/v1/connections/conn_openrouter/chat/completions`);
  });

  it("sends the selected model and an OpenAI-compatible message array", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = mockFetch((_url, init) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    });
    await new OpenRouterAdapter({
      gatewayBaseUrl: GATEWAY,
      connection: connection("openrouter", { selectedModel: "vendor/model" }),
      fetchImpl,
    }).complete({ prompt: "user text", systemPrompt: "system rules" });
    expect(body.model).toBe("vendor/model");
    expect(body.messages).toEqual([
      { role: "system", content: "system rules" },
      { role: "user", content: "user text" },
    ]);
  });

  it("never sends an Authorization header, so no user key is in the browser", async () => {
    let headers: Record<string, string> = {};
    const fetchImpl = mockFetch((_url, init) => {
      headers = init.headers as Record<string, string>;
      return jsonResponse({ choices: [] });
    });
    await new OpenRouterAdapter({
      gatewayBaseUrl: GATEWAY,
      connection: connection("openrouter"),
      fetchImpl,
    }).complete({ prompt: "hi" });
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain("authorization");
  });

  it("refuses a policy-rejected custom base URL", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}));
    const error = (await new OpenRouterAdapter({
      gatewayBaseUrl: GATEWAY,
      connection: connection("openrouter", {
        baseOrigin: { origin: "https://self-hosted.example", classification: "policyRejected" },
      }),
      fetchImpl,
    })
      .complete({ prompt: "hi" })
      .catch((err: unknown) => err)) as LlmError;
    expect(error).toBeInstanceOf(LlmError);
    expect(error.message).toMatch(/policy refuses/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows a user-approved self-hosted base URL", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    const instance = new OpenRouterAdapter({
      gatewayBaseUrl: GATEWAY,
      connection: connection("openrouter", {
        baseOrigin: {
          origin: "https://self-hosted.example",
          classification: "userApprovedSelfHosted",
        },
      }),
      fetchImpl,
    });
    expect(instance.configured).toBe(true);
    await expect(instance.complete({ prompt: "hi" })).resolves.toBeTruthy();
  });
});

describe("createOpenRouterConnection", () => {
  it("builds a broker-API-key record", () => {
    const record = createOpenRouterConnection("conn_1");
    expect(record.authMode).toBe("brokerApiKey");
    expect(record.provider).toBe("openrouter");
  });

  it("has no credential-capable field", () => {
    const forbidden = /key|token|secret|password/i;
    expect(
      Object.keys(createOpenRouterConnection("conn_1")).filter((k) => forbidden.test(k)),
    ).toEqual([]);
  });
});
