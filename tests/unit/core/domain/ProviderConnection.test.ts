import { describe, expect, it } from "vitest";
import {
  BaseOriginSchema,
  ConnectionStatusSchema,
  ModelCatalogSchema,
  ProviderConnectionSchema,
  ProviderIdSchema,
  TERMINAL_CONNECTION_STATUSES,
  createDisconnectedConnection,
  isBaseOriginUsable,
  isModelSelectable,
  isReadyStatus,
  isRemoteProvider,
  isTerminalStatus,
} from "../../../../src/core/domain/ProviderConnection";

function rawConnection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    connectionId: "conn_abc123",
    provider: "openai",
    authMode: "deploymentManaged",
    status: "connected",
    ...overrides,
  };
}

function connection(overrides: Partial<Record<string, unknown>> = {}) {
  return ProviderConnectionSchema.parse(rawConnection(overrides));
}

function catalog(overrides: Partial<Record<string, unknown>> = {}) {
  return ModelCatalogSchema.parse({
    provider: "openai",
    connectionId: "conn_abc123",
    fetchedAt: "2026-09-26T10:00:00.000Z",
    models: [{ id: "gpt-4o-mini", displayName: "GPT-4o mini" }],
    ...overrides,
  });
}

describe("ProviderId", () => {
  it("accepts the three named providers plus the offline mock", () => {
    expect(ProviderIdSchema.options).toEqual(["openai", "anthropic", "openrouter", "mock"]);
  });

  it("rejects an unknown provider", () => {
    expect(ProviderIdSchema.safeParse("ollama").success).toBe(false);
  });

  it("treats every provider except mock as remote", () => {
    expect(isRemoteProvider("openai")).toBe(true);
    expect(isRemoteProvider("anthropic")).toBe(true);
    expect(isRemoteProvider("openrouter")).toBe(true);
    expect(isRemoteProvider("mock")).toBe(false);
  });
});

describe("ProviderConnectionSchema", () => {
  it("parses a non-secret connected record", () => {
    const record = connection({ selectedModel: "gpt-4o-mini" });
    expect(record.status).toBe("connected");
    expect(record.allowCustomModel).toBe(false);
  });

  it("defaults allowCustomModel to false so the catalog is not an allowlist", () => {
    expect(connection().allowCustomModel).toBe(false);
  });

  it("exposes every lifecycle status named in the phase contract", () => {
    const expected = [
      "startAuthorization",
      "callback",
      "connected",
      "reconnectRequired",
      "expired",
      "revoked",
      "disconnected",
      "failed",
    ];
    expect([...ConnectionStatusSchema.options].sort()).toEqual([...expected].sort());
  });

  it("rejects an empty connection id", () => {
    expect(ProviderConnectionSchema.safeParse(rawConnection({ connectionId: "" })).success).toBe(
      false,
    );
  });

  it("rejects a lastVerifiedAt that is not an ISO datetime", () => {
    expect(
      ProviderConnectionSchema.safeParse(rawConnection({ lastVerifiedAt: "yesterday" })).success,
    ).toBe(false);
  });

  it("rejects an unknown provider", () => {
    expect(ProviderConnectionSchema.safeParse(rawConnection({ provider: "ollama" })).success).toBe(
      false,
    );
  });

  it("has no field capable of holding a secret", () => {
    // The persisted record must never be able to carry a key or token. Guard
    // the shape itself, because a later "convenience" field would be a
    // credential-storage regression.
    const keys = Object.keys(ProviderConnectionSchema.shape);
    const forbidden = /key|token|secret|verifier|password|auth_?header/i;
    expect(keys.filter((key) => forbidden.test(key))).toEqual([]);
  });
});

describe("connection status helpers", () => {
  it("treats only connected as ready", () => {
    expect(isReadyStatus("connected")).toBe(true);
    expect(isReadyStatus("expired")).toBe(false);
    expect(isReadyStatus("reconnectRequired")).toBe(false);
    expect(isReadyStatus("failed")).toBe(false);
  });

  it("treats revoked and disconnected as terminal for a connection id", () => {
    expect(TERMINAL_CONNECTION_STATUSES).toEqual(["revoked", "disconnected"]);
    expect(isTerminalStatus("revoked")).toBe(true);
    expect(isTerminalStatus("disconnected")).toBe(true);
    expect(isTerminalStatus("expired")).toBe(false);
  });
});

describe("createDisconnectedConnection", () => {
  it("creates a disconnected record for a remote provider using the deployment-managed mode", () => {
    const record = createDisconnectedConnection("anthropic");
    expect(record.status).toBe("disconnected");
    expect(record.authMode).toBe("deploymentManaged");
    expect(record.provider).toBe("anthropic");
  });

  it("creates an unauthenticated record for the offline mock provider", () => {
    expect(createDisconnectedConnection("mock").authMode).toBe("none");
  });
});

describe("isModelSelectable", () => {
  it("accepts a model present in the fetched catalog", () => {
    expect(isModelSelectable(catalog(), "gpt-4o-mini", false)).toBe(true);
  });

  it("rejects an absent model unless custom models are policy-permitted", () => {
    expect(isModelSelectable(catalog(), "gpt-4o", false)).toBe(false);
    expect(isModelSelectable(catalog(), "gpt-4o", true)).toBe(true);
  });

  it("rejects an empty selection even when custom models are permitted", () => {
    expect(isModelSelectable(catalog(), undefined, true)).toBe(false);
  });

  it("treats a custom model as a policy exception when no catalog has loaded", () => {
    expect(isModelSelectable(null, "vendor/custom", false)).toBe(false);
    expect(isModelSelectable(null, "vendor/custom", true)).toBe(true);
  });
});

describe("BaseOriginSchema", () => {
  it("records a normalized origin with its policy classification", () => {
    const base = BaseOriginSchema.parse({
      origin: "https://openrouter.ai/api/v1",
      classification: "deploymentDefault",
    });
    expect(base.origin).toBe("https://openrouter.ai/api/v1");
  });

  it("rejects an unknown classification so a URL cannot imply trust", () => {
    expect(
      BaseOriginSchema.safeParse({ origin: "https://evil.example", classification: "trusted" })
        .success,
    ).toBe(false);
  });
});

describe("isBaseOriginUsable", () => {
  it("allows a connection with no configured base origin", () => {
    expect(isBaseOriginUsable(undefined)).toBe(true);
  });

  it("refuses a policy-rejected origin even when it was persisted earlier", () => {
    const rejected = BaseOriginSchema.parse({
      origin: "https://not-allowlisted.example",
      classification: "policyRejected",
    });
    expect(isBaseOriginUsable(rejected)).toBe(false);
  });

  it("allows an allowlisted policy origin", () => {
    const allowed = BaseOriginSchema.parse({
      origin: "https://openrouter.ai",
      classification: "policyAllowed",
    });
    expect(isBaseOriginUsable(allowed)).toBe(true);
  });
});
