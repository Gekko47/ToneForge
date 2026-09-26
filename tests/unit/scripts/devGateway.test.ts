import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  GATEWAY_PATH_PREFIX,
  OPENROUTER_DEFAULT_BASE_URL,
  classifyUpstreamBaseUrl,
  createDevGatewayBroker,
  validateChatPayload,
} from "../../../scripts/dev-gateway.mjs";

const NONCE = "a".repeat(64);

function request(options: {
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  origin?: string;
  host?: string;
  nonce?: string | null;
}) {
  const headers: Record<string, string> = {
    host: options.host ?? "localhost:3000",
    origin: options.origin ?? "https://localhost:3000",
    "content-type": "application/json",
    ...options.headers,
  };
  if (options.nonce !== null) {
    headers["x-toneforge-session-nonce"] = options.nonce ?? NONCE;
  }
  const payload = options.body === undefined ? "" : JSON.stringify(options.body);
  const stream = Readable.from([Buffer.from(payload)]);
  return Object.assign(stream, {
    method: options.method,
    url: options.url,
    headers,
  });
}

function response() {
  const chunks: string[] = [];
  return {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: () => chunks.join(""),
    json: () => JSON.parse(chunks.join("") || "{}"),
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    // The proxied chat path writes a Buffer rather than a string, so both have
    // to be collected or the response body would read back empty.
    end(chunk?: string | Uint8Array) {
      if (typeof chunk === "string") chunks.push(chunk);
      else if (chunk) chunks.push(new TextDecoder().decode(chunk));
    },
  };
}

/** Cast a zero-argument mock to `fetch`; the broker only ever calls it. */
function asFetch(mock: unknown): typeof fetch {
  return mock as typeof fetch;
}

function okJson(payload: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
    json: async () => payload,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(payload)),
  };
}

describe("classifyUpstreamBaseUrl", () => {
  it("treats the official OpenRouter origin as the deployment default", () => {
    expect(classifyUpstreamBaseUrl(OPENROUTER_DEFAULT_BASE_URL)).toEqual({
      baseUrl: OPENROUTER_DEFAULT_BASE_URL,
      classification: "deploymentDefault",
    });
  });

  it("normalizes a trailing slash away", () => {
    expect(classifyUpstreamBaseUrl("https://openrouter.ai/api/v1/")?.baseUrl).toBe(
      OPENROUTER_DEFAULT_BASE_URL,
    );
  });

  it("refuses a plaintext HTTP origin", () => {
    expect(classifyUpstreamBaseUrl("http://openrouter.ai/api/v1")).toBeNull();
  });

  it("refuses a URL carrying embedded credentials", () => {
    expect(classifyUpstreamBaseUrl("https://user:pass@openrouter.ai/api/v1")).toBeNull();
  });

  it("refuses an unparseable value", () => {
    expect(classifyUpstreamBaseUrl("not a url")).toBeNull();
    expect(classifyUpstreamBaseUrl(undefined)).toBeNull();
  });

  it("classifies another HTTPS origin as a self-hosted endpoint", () => {
    expect(classifyUpstreamBaseUrl("https://llm.internal.example/v1")?.classification).toBe(
      "userApprovedSelfHosted",
    );
  });
});

describe("validateChatPayload", () => {
  it("accepts a bounded chat-completions body", () => {
    expect(
      validateChatPayload({ model: "m", messages: [{ role: "user", content: "hi" }] }).valid,
    ).toBe(true);
  });

  it("rejects a body with no model", () => {
    expect(validateChatPayload({ messages: [] }).valid).toBe(false);
  });

  it("rejects a body that is not an object", () => {
    expect(validateChatPayload("nope").valid).toBe(false);
  });

  it("rejects an oversized message", () => {
    expect(
      validateChatPayload({
        model: "m",
        messages: [{ role: "user", content: "x".repeat(100_001) }],
      }).valid,
    ).toBe(false);
  });
});

describe("createDevGatewayBroker", () => {
  it("passes unrelated paths through untouched", async () => {
    const next = vi.fn();
    await createDevGatewayBroker()(
      request({ method: "GET", url: "/some/other/path" }) as never,
      response() as never,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("refuses every gateway route without a valid origin or nonce", async () => {
    const res = response();
    await createDevGatewayBroker({ expectedNonce: NONCE })(
      request({
        method: "POST",
        url: `${GATEWAY_PATH_PREFIX}/connections/api-key`,
        body: { provider: "openrouter", apiKey: "sk-or-test" },
        nonce: null,
        origin: "https://evil.example",
      }) as never,
      res as never,
      vi.fn(),
    );
    expect(res.statusCode).toBe(403);
    expect(res.body()).not.toContain("sk-or-test");
  });

  it("returns only non-secret metadata for a new API-key connection", async () => {
    const res = response();
    const connections = new Map();
    await createDevGatewayBroker({ expectedNonce: NONCE, connections })(
      request({
        method: "POST",
        url: `${GATEWAY_PATH_PREFIX}/connections/api-key`,
        body: { provider: "openrouter", apiKey: "sk-or-secret-value" },
      }) as never,
      res as never,
      vi.fn(),
    );
    expect(res.statusCode).toBe(200);
    const payload = res.json();
    expect(payload.provider).toBe("openrouter");
    expect(payload.status).toBe("connected");
    // The opaque reference travels back; the key never does.
    expect(payload.connectionId).toMatch(/^or_[0-9a-f]{32}$/);
    expect(res.body()).not.toContain("sk-or-secret-value");
  });

  it("retains the key in the process store, not in the response", async () => {
    const connections = new Map();
    const res = response();
    await createDevGatewayBroker({ expectedNonce: NONCE, connections })(
      request({
        method: "POST",
        url: `${GATEWAY_PATH_PREFIX}/connections/api-key`,
        body: { provider: "openrouter", apiKey: "sk-or-secret-value" },
      }) as never,
      res as never,
      vi.fn(),
    );
    expect(Array.from(connections.values())[0]?.apiKey).toBe("sk-or-secret-value");
    expect(res.body()).not.toContain("sk-or-secret-value");
  });

  it("rejects an empty API key", async () => {
    const res = response();
    await createDevGatewayBroker({ expectedNonce: NONCE })(
      request({
        method: "POST",
        url: `${GATEWAY_PATH_PREFIX}/connections/api-key`,
        body: { provider: "openrouter", apiKey: "   " },
      }) as never,
      res as never,
      vi.fn(),
    );
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-OpenRouter provider for an API-key connection", async () => {
    const res = response();
    await createDevGatewayBroker({ expectedNonce: NONCE })(
      request({
        method: "POST",
        url: `${GATEWAY_PATH_PREFIX}/connections/api-key`,
        body: { provider: "anthropic", apiKey: "sk-or-test" },
      }) as never,
      res as never,
      vi.fn(),
    );
    expect(res.statusCode).toBe(400);
  });

  it("requires explicit approval for a self-hosted base URL", async () => {
    const unapproved = response();
    await createDevGatewayBroker({ expectedNonce: NONCE })(
      request({
        method: "POST",
        url: `${GATEWAY_PATH_PREFIX}/connections/api-key`,
        body: { provider: "openrouter", apiKey: "sk-or-test", baseUrl: "https://llm.internal/v1" },
      }) as never,
      unapproved as never,
      vi.fn(),
    );
    expect(unapproved.statusCode).toBe(403);

    const approved = response();
    await createDevGatewayBroker({ expectedNonce: NONCE })(
      request({
        method: "POST",
        url: `${GATEWAY_PATH_PREFIX}/connections/api-key`,
        body: {
          provider: "openrouter",
          apiKey: "sk-or-test",
          baseUrl: "https://llm.internal/v1",
          approveSelfHosted: true,
        },
      }) as never,
      approved as never,
      vi.fn(),
    );
    expect(approved.statusCode).toBe(200);
  });

  it("rejects a plaintext base URL", async () => {
    const res = response();
    await createDevGatewayBroker({ expectedNonce: NONCE })(
      request({
        method: "POST",
        url: `${GATEWAY_PATH_PREFIX}/connections/api-key`,
        body: {
          provider: "openrouter",
          apiKey: "sk-or-test",
          baseUrl: "http://openrouter.ai/api/v1",
        },
      }) as never,
      res as never,
      vi.fn(),
    );
    expect(res.statusCode).toBe(400);
  });

  it("fetches the model list with the stored key and returns the client contract shape", async () => {
    const mockFetchImpl = vi.fn(async () => okJson({ data: [{ id: "vendor/model" }] }));
    const fetchImpl = asFetch(mockFetchImpl);
    const connections = new Map([
      ["or_1", { apiKey: "sk-or-secret", baseUrl: OPENROUTER_DEFAULT_BASE_URL }],
    ]);
    const res = response();
    await createDevGatewayBroker({ expectedNonce: NONCE, fetchImpl, connections })(
      request({ method: "GET", url: `${GATEWAY_PATH_PREFIX}/connections/or_1/models` }) as never,
      res as never,
      vi.fn(),
    );
    expect(res.statusCode).toBe(200);
    // The gateway client validates `models`; a `data` list would be rejected.
    expect(res.json().models).toEqual([
      {
        id: "vendor/model",
        displayName: "vendor/model",
        description: "",
        contextWindow: null,
        inputModalities: [],
        outputModalities: [],
        supportsStructuredOutput: false,
        supportsTools: false,
        supportsReasoning: false,
        deprecated: false,
      },
    ]);
    expect(res.json().data).toBeUndefined();
    // The key is used server-side on the upstream call and never returned.
    const upstreamInit = (mockFetchImpl.mock.calls as unknown[][])[0]?.[1] as {
      headers: Record<string, string>;
    };
    expect(upstreamInit.headers.Authorization).toBe("Bearer sk-or-secret");
    expect(res.body()).not.toContain("sk-or-secret");
  });

  it("refuses a model list for an unknown connection", async () => {
    const res = response();
    await createDevGatewayBroker({ expectedNonce: NONCE, connections: new Map() })(
      request({
        method: "GET",
        url: `${GATEWAY_PATH_PREFIX}/connections/or_missing/models`,
      }) as never,
      res as never,
      vi.fn(),
    );
    expect(res.statusCode).toBe(404);
  });

  it("drops the stored key on disconnect", async () => {
    const connections = new Map([
      ["or_1", { apiKey: "sk-or-secret", baseUrl: OPENROUTER_DEFAULT_BASE_URL }],
    ]);
    const res = response();
    await createDevGatewayBroker({ expectedNonce: NONCE, connections })(
      request({ method: "DELETE", url: `${GATEWAY_PATH_PREFIX}/connections/or_1` }) as never,
      res as never,
      vi.fn(),
    );
    expect(res.statusCode).toBe(204);
    expect(connections.has("or_1")).toBe(false);
  });

  it("forwards a valid chat completion and returns the upstream result", async () => {
    const mockFetchImpl = vi.fn(async () => okJson({ choices: [{ message: { content: "ok" } }] }));
    const fetchImpl = asFetch(mockFetchImpl);
    const connections = new Map([
      ["or_1", { apiKey: "sk-or-secret", baseUrl: OPENROUTER_DEFAULT_BASE_URL }],
    ]);
    const res = response();
    await createDevGatewayBroker({ expectedNonce: NONCE, fetchImpl, connections })(
      request({
        method: "POST",
        url: `${GATEWAY_PATH_PREFIX}/connections/or_1/chat/completions`,
        body: { model: "vendor/model", messages: [{ role: "user", content: "hi" }] },
      }) as never,
      res as never,
      vi.fn(),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().choices[0].message.content).toBe("ok");
  });

  it("rejects a chat body with no model before calling upstream", async () => {
    const fetchImpl = asFetch(vi.fn(async () => okJson({})));
    const connections = new Map([
      ["or_1", { apiKey: "sk-or-secret", baseUrl: OPENROUTER_DEFAULT_BASE_URL }],
    ]);
    const res = response();
    await createDevGatewayBroker({ expectedNonce: NONCE, fetchImpl, connections })(
      request({
        method: "POST",
        url: `${GATEWAY_PATH_PREFIX}/connections/or_1/chat/completions`,
        body: { messages: [{ role: "user", content: "hi" }] },
      }) as never,
      res as never,
      vi.fn(),
    );
    expect(res.statusCode).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never surfaces an upstream error body that could echo the key", async () => {
    const fetchImpl = asFetch(
      vi.fn(async () => ({
        ok: false,
        status: 500,
      })),
    );
    const connections = new Map([
      ["or_1", { apiKey: "sk-or-secret", baseUrl: OPENROUTER_DEFAULT_BASE_URL }],
    ]);
    const res = response();
    await createDevGatewayBroker({ expectedNonce: NONCE, fetchImpl, connections })(
      request({ method: "GET", url: `${GATEWAY_PATH_PREFIX}/connections/or_1/models` }) as never,
      res as never,
      vi.fn(),
    );
    expect(res.body()).not.toContain("sk-or-secret");
    expect(res.json().error).toBe("Model list request failed");
  });

  it("returns 404 for an unknown gateway route", async () => {
    const res = response();
    await createDevGatewayBroker({ expectedNonce: NONCE })(
      request({ method: "GET", url: `${GATEWAY_PATH_PREFIX}/nonsense` }) as never,
      res as never,
      vi.fn(),
    );
    expect(res.statusCode).toBe(404);
  });
});
