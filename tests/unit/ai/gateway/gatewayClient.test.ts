import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GatewayError,
  HttpProviderGatewayClient,
  SessionTokenStore,
  isValidGatewayOrigin,
  normalizeGatewayOrigin,
  createProviderGatewayClient,
} from "../../../../src/ai/gateway/gatewayClient";
import {
  ProviderConnectionSchema,
  type ProviderConnection,
} from "../../../../src/core/domain/ProviderConnection";

vi.mock("../../../../src/shared/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const ORIGIN = "https://localhost:3000";

function connection(overrides: Partial<Record<string, unknown>> = {}): ProviderConnection {
  return ProviderConnectionSchema.parse({
    connectionId: "conn_abc123",
    provider: "openrouter",
    authMode: "brokerApiKey",
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

function client(fetchImpl: typeof fetch, tokenStore = new SessionTokenStore()) {
  return new HttpProviderGatewayClient({
    origin: ORIGIN,
    tokenStore,
    fetchImpl,
    maxRetries: 0,
  });
}

describe("gateway origin validation", () => {
  it("accepts a same-origin path", () => {
    expect(isValidGatewayOrigin("/__toneforge/gateway/v1")).toBe(true);
  });

  it("rejects a protocol-relative path", () => {
    expect(isValidGatewayOrigin("//evil.example/v1")).toBe(false);
  });

  it("accepts loopback development origins", () => {
    expect(isValidGatewayOrigin("https://localhost:3000")).toBe(true);
    expect(isValidGatewayOrigin("http://127.0.0.1:3000")).toBe(true);
  });

  it("rejects a user-entered production origin so settings cannot point at an arbitrary host", () => {
    expect(isValidGatewayOrigin("https://gateway.example.com")).toBe(false);
    expect(isValidGatewayOrigin("https://evil.example")).toBe(false);
  });

  it("rejects an origin carrying embedded credentials", () => {
    expect(isValidGatewayOrigin("https://user:pass@localhost:3000")).toBe(false);
  });

  it("rejects a non-HTTP scheme", () => {
    expect(isValidGatewayOrigin("ftp://localhost:3000")).toBe(false);
  });

  it("normalizes a trailing slash away", () => {
    expect(normalizeGatewayOrigin("https://localhost:3000/")).toBe("https://localhost:3000");
  });

  it("degrades an untrusted origin to null rather than passing it to fetch", () => {
    expect(normalizeGatewayOrigin("https://evil.example")).toBeNull();
    expect(normalizeGatewayOrigin(undefined)).toBeNull();
  });
});

describe("SessionTokenStore", () => {
  it("stores, reads, and clears a token in memory", () => {
    const store = new SessionTokenStore();
    store.set("conn_1", "opaque-session");
    expect(store.get("conn_1")).toBe("opaque-session");
    expect(store.has("conn_1")).toBe(true);
    store.clear("conn_1");
    expect(store.get("conn_1")).toBeUndefined();
  });

  it("clears every token on sign-out", () => {
    const store = new SessionTokenStore();
    store.set("conn_1", "a");
    store.set("conn_2", "b");
    store.clearAll();
    expect(store.size).toBe(0);
  });

  it("never exposes a token value through diagnostics", () => {
    const store = new SessionTokenStore();
    store.set("conn_1", "super-secret-token");
    expect(JSON.stringify(store.describe())).not.toContain("super-secret-token");
  });

  it("has no serialization method that could persist a token", () => {
    const store = new SessionTokenStore();
    store.set("conn_1", "secret");
    const forbidden = ["toJSON", "serialize", "persist", "toStorage", "save"];
    expect(forbidden.filter((name) => typeof (store as never)[name] === "function")).toEqual([]);
  });
});

describe("HttpProviderGatewayClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses every operation when no valid origin is configured", async () => {
    const gateway = new HttpProviderGatewayClient({
      origin: "https://evil.example",
      tokenStore: new SessionTokenStore(),
    });
    expect(gateway.configured).toBe(false);
    await expect(gateway.startAuthorization("openai")).rejects.toThrow(GatewayError);
  });

  it("returns the authorization URL from the gateway", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ authorizationUrl: "https://auth.example/authorize?x=1" }),
    ) as unknown as typeof fetch;
    const url = await client(fetchImpl).startAuthorization("anthropic");
    expect(url).toContain("auth.example");
  });

  it("refuses an authorization response with no URL", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    await expect(client(fetchImpl).startAuthorization("anthropic")).rejects.toThrow(
      /authorization URL/,
    );
  });

  it("validates a callback response into a ProviderConnection", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        connectionId: "conn_1",
        provider: "anthropic",
        authMode: "oauth",
        status: "connected",
        accountLabel: "Team account",
      }),
    ) as unknown as typeof fetch;
    const result = await client(fetchImpl).completeAuthorization(
      "anthropic",
      "https://app.example/cb?code=1",
    );
    expect(result.provider).toBe("anthropic");
    expect(result.status).toBe("connected");
  });

  it("refuses a connection issued for a different provider than requested", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        connectionId: "conn_1",
        provider: "openai",
        authMode: "oauth",
        status: "connected",
      }),
    ) as unknown as typeof fetch;
    await expect(
      client(fetchImpl).completeAuthorization("anthropic", "https://app.example/cb"),
    ).rejects.toThrow(/different provider/);
  });

  it("refuses a callback response missing required fields", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ provider: "openrouter", status: "connected" }),
    ) as unknown as typeof fetch;
    await expect(
      client(fetchImpl).completeAuthorization("openrouter", "https://app.example/cb"),
    ).rejects.toThrow(/unreadable connection/);
  });

  it("sends a user-supplied key once and never retains it", async () => {
    const store = new SessionTokenStore();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        connectionId: "conn_or",
        provider: "openrouter",
        authMode: "brokerApiKey",
        status: "connected",
      }),
    ) as unknown as typeof fetch;
    const gateway = client(fetchImpl, store);
    const result = await gateway.submitBrokerApiKey(
      "openrouter",
      "sk-or-v1-usersupplied",
      "https://openrouter.ai/api/v1",
    );
    expect(result.connectionId).toBe("conn_or");
    // The key is not retained anywhere the add-in can later read it back.
    expect(JSON.stringify(store.describe())).not.toContain("sk-or-v1");
    expect(JSON.stringify(result)).not.toContain("sk-or-v1");
  });

  it("refuses an empty API key before making a request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    const gateway = client(fetchImpl);
    await expect(
      gateway.submitBrokerApiKey("openrouter", "   ", "https://openrouter.ai/api/v1"),
    ).rejects.toThrow(/API key is required/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("normalizes a model catalog and defaults a missing display name to the id", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        connectionId: "conn_abc123",
        fetchedAt: "2026-09-26T10:00:00.000Z",
        models: [{ id: "vendor/model-a", contextWindow: 128000 }],
      }),
    ) as unknown as typeof fetch;
    const catalog = await client(fetchImpl).fetchModelCatalog(connection());
    expect(catalog.provider).toBe("openrouter");
    expect(catalog.models[0]?.displayName).toBe("vendor/model-a");
    expect(catalog.models[0]?.supportsTools).toBe(false);
  });

  it("refuses a catalog belonging to a different connection", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        connectionId: "conn_other",
        fetchedAt: "2026-09-26T10:00:00.000Z",
        models: [],
      }),
    ) as unknown as typeof fetch;
    await expect(client(fetchImpl).fetchModelCatalog(connection())).rejects.toThrow(
      /does not belong/,
    );
  });

  it("refuses an unreadable catalog", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ connectionId: "conn_abc123" }),
    ) as unknown as typeof fetch;
    await expect(client(fetchImpl).fetchModelCatalog(connection())).rejects.toThrow(
      /unreadable model catalog/,
    );
  });

  it("sends the session token as a bearer header for a connection request", async () => {
    const store = new SessionTokenStore();
    store.set("conn_abc123", "opaque-session-token");
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        connectionId: "conn_abc123",
        fetchedAt: "2026-09-26T10:00:00.000Z",
        models: [],
      }),
    ) as unknown as typeof fetch;
    await client(fetchImpl, store).fetchModelCatalog(connection());
    const init = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe("Bearer opaque-session-token");
  });

  it("classifies 401 as a non-retryable unauthorized error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 401, "Unauthorized"),
    ) as unknown as typeof fetch;
    const error = await client(fetchImpl)
      .fetchModelCatalog(connection())
      .catch((err: unknown) => err as GatewayError);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).kind).toBe("unauthorized");
    expect((error as GatewayError).retryable).toBe(false);
  });

  it("classifies 403 as a non-retryable refusal", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 403, "Forbidden"),
    ) as unknown as typeof fetch;
    const error = (await client(fetchImpl)
      .fetchModelCatalog(connection())
      .catch((err: unknown) => err)) as GatewayError;
    expect(error.kind).toBe("forbidden");
    expect(error.retryable).toBe(false);
  });

  it("classifies 429 as retryable", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, 429, "Too Many"),
    ) as unknown as typeof fetch;
    const error = (await client(fetchImpl)
      .fetchModelCatalog(connection())
      .catch((err: unknown) => err)) as GatewayError;
    expect(error.kind).toBe("rateLimited");
    expect(error.retryable).toBe(true);
  });

  it("fails fast without a network call when the caller already aborted", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    const controller = new AbortController();
    controller.abort();
    const error = (await client(fetchImpl)
      .fetchModelCatalog(connection(), controller.signal)
      .catch((err: unknown) => err)) as GatewayError;
    expect(error.kind).toBe("aborted");
    expect(error.retryable).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries a transient server error and then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({}, 503, "Unavailable")
        : jsonResponse({
            connectionId: "conn_abc123",
            fetchedAt: "2026-09-26T10:00:00.000Z",
            models: [],
          });
    }) as unknown as typeof fetch;
    const store = new SessionTokenStore();
    const gateway = new HttpProviderGatewayClient({ origin: ORIGIN, tokenStore: store, fetchImpl });
    const catalog = await gateway.fetchModelCatalog(connection());
    expect(catalog.connectionId).toBe("conn_abc123");
    expect(calls).toBe(2);
  });

  it("forgets the local token on disconnect so a failed call cannot leave it usable", async () => {
    const store = new SessionTokenStore();
    store.set("conn_abc123", "opaque-session-token");
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    await expect(client(fetchImpl, store).disconnect(connection())).rejects.toThrow(GatewayError);
    expect(store.get("conn_abc123")).toBeUndefined();
  });

  it("forgets the local token after a successful disconnect", async () => {
    const store = new SessionTokenStore();
    store.set("conn_abc123", "opaque-session-token");
    const fetchImpl = vi.fn(async () => jsonResponse({}, 204)) as unknown as typeof fetch;
    await client(fetchImpl, store).disconnect(connection());
    expect(store.size).toBe(0);
  });
});

describe("createProviderGatewayClient", () => {
  it("returns a configured client that satisfies the contract", () => {
    const gateway = createProviderGatewayClient({
      origin: ORIGIN,
      tokenStore: new SessionTokenStore(),
    });
    expect(gateway.configured).toBe(true);
    expect(typeof gateway.fetchModelCatalog).toBe("function");
  });
});
