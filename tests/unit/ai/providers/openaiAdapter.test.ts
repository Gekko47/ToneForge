import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAiAdapter, createOpenAiConnection } from "../../../../src/ai/providers/openaiAdapter";
import { LlmError } from "../../../../src/ai/providers/LlmProvider";
import { ProviderConnectionSchema } from "../../../../src/core/domain/ProviderConnection";

vi.mock("../../../../src/shared/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const GATEWAY = "https://localhost:3000";

function connection(overrides: Partial<Record<string, unknown>> = {}) {
  return ProviderConnectionSchema.parse({
    connectionId: "conn_openai",
    provider: "openai",
    authMode: "deploymentManaged",
    status: "connected",
    ...overrides,
  });
}

function jsonResponse(body: unknown, status = 200, statusText = "OK"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  } as unknown as Response;
}

function adapter(
  fetchImpl: typeof fetch,
  overrides: Partial<Record<string, unknown>> = {},
  gatewayBaseUrl = GATEWAY,
) {
  return new OpenAiAdapter({
    gatewayBaseUrl,
    connection: connection(overrides),
    fetchImpl,
    maxRetries: 0,
  });
}

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string, init: RequestInit) =>
    handler(url, init),
  ) as unknown as typeof fetch;
}

describe("OpenAiAdapter (gateway-routed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the request to the gateway connection, not to the provider", async () => {
    let seenUrl = "";
    const fetchImpl = mockFetch((url) => {
      seenUrl = url;
      return jsonResponse({ choices: [{ message: { content: "ok" } }], model: "gpt-4o-mini" });
    });
    await adapter(fetchImpl).complete({ prompt: "hi" });
    expect(seenUrl).toBe(`${GATEWAY}/v1/connections/conn_openai/chat/completions`);
  });

  it("never sends an Authorization header", async () => {
    let seenHeaders: Record<string, string> = {};
    const fetchImpl = mockFetch((_url, init) => {
      seenHeaders = init.headers as Record<string, string>;
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    });
    await adapter(fetchImpl).complete({ prompt: "hi" });
    // The credential lives in the gateway. If a header ever appeared here it
    // would mean a browser-held credential had been reintroduced.
    expect(Object.keys(seenHeaders).map((key) => key.toLowerCase())).not.toContain("authorization");
  });

  it("has no option to accept a user-supplied API key", () => {
    const adapterInstance = adapter(
      mockFetch(() => jsonResponse({ choices: [{ message: { content: "ok" } }] })),
    );
    expect(adapterInstance.configured).toBe(true);
    // The removed credential mode must not reappear as a settable field.
    expect("apiKey" in (adapterInstance as unknown as Record<string, unknown>)).toBe(false);
  });

  it("normalizes a chat-completions response", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({
        choices: [{ message: { content: "answer" } }],
        model: "gpt-4o-mini",
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      }),
    );
    const result = await adapter(fetchImpl).complete({ prompt: "hi" });
    expect(result.text).toBe("answer");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
  });

  it("sends the system prompt as a system message and the prompt as a user message", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = mockFetch((_url, init) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    });
    await adapter(fetchImpl, { selectedModel: "gpt-4o-mini" }).complete({
      prompt: "user text",
      systemPrompt: "system rules",
    });
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages).toEqual([
      { role: "system", content: "system rules" },
      { role: "user", content: "user text" },
    ]);
  });

  it("omits max_tokens when the caller did not set one", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = mockFetch((_url, init) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    });
    await adapter(fetchImpl).complete({ prompt: "hi" });
    expect("max_tokens" in body).toBe(false);
  });

  it("refuses when the connection is not ready", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}));
    const error = (await adapter(fetchImpl, { status: "expired" })
      .complete({ prompt: "hi" })
      .catch((err: unknown) => err)) as LlmError;
    expect(error).toBeInstanceOf(LlmError);
    expect(error.retryable).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a connection belonging to a different provider", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}));
    const error = (await new OpenAiAdapter({
      gatewayBaseUrl: GATEWAY,
      connection: ProviderConnectionSchema.parse({
        connectionId: "conn_other",
        provider: "anthropic",
        authMode: "oauth",
        status: "connected",
      }),
      fetchImpl,
    })
      .complete({ prompt: "hi" })
      .catch((err: unknown) => err)) as LlmError;
    expect(error).toBeInstanceOf(LlmError);
    expect(error.message).toMatch(/anthropic connection/);
  });

  it("refuses a policy-rejected base origin", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}));
    const error = (await adapter(fetchImpl, {
      baseOrigin: { origin: "https://not-allowlisted.example", classification: "policyRejected" },
    })
      .complete({ prompt: "hi" })
      .catch((err: unknown) => err)) as LlmError;
    expect(error).toBeInstanceOf(LlmError);
    expect(error.message).toMatch(/policy refuses/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails fast without a network call when the caller already aborted", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}));
    const controller = new AbortController();
    controller.abort();
    const error = (await adapter(fetchImpl)
      .complete({ prompt: "hi", signal: controller.signal })
      .catch((err: unknown) => err)) as LlmError;
    expect(error.retryable).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats 401 as non-retryable so a rejected connection is not retried", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({}, 401, "Unauthorized"));
    const error = (await adapter(fetchImpl)
      .complete({ prompt: "hi" })
      .catch((err: unknown) => err)) as LlmError;
    expect(error.retryable).toBe(false);
  });

  it("treats 429 and 5xx as retryable", async () => {
    const rateLimited = (await adapter(mockFetch(() => jsonResponse({}, 429, "Too Many")))
      .complete({ prompt: "hi" })
      .catch((err: unknown) => err)) as LlmError;
    expect(rateLimited.retryable).toBe(true);

    const serverError = (await adapter(mockFetch(() => jsonResponse({}, 503, "Unavailable")))
      .complete({ prompt: "hi" })
      .catch((err: unknown) => err)) as LlmError;
    expect(serverError.retryable).toBe(true);
  });

  it("redacts sensitive patterns through the shared redact contract", () => {
    const instance = adapter(mockFetch(() => jsonResponse({})));
    expect(instance.redact("mail me at a@b.com or use sk-ABCDEFGHIJKL")).not.toMatch(
      /sk-ABCDEFGHIJKL/,
    );
  });
});

describe("createOpenAiConnection", () => {
  it("builds a deployment-managed OpenAI record", () => {
    const record = createOpenAiConnection("conn_1");
    expect(record.provider).toBe("openai");
    expect(record.authMode).toBe("deploymentManaged");
    expect(record.status).toBe("connected");
  });

  it("has no field capable of holding a credential", () => {
    const record = createOpenAiConnection("conn_1");
    const forbidden = /key|token|secret|password/i;
    expect(Object.keys(record).filter((field) => forbidden.test(field))).toEqual([]);
  });
});
