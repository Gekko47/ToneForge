import { describe, expect, it } from "vitest";
import { CURRENT_STATE_VERSION, migrate } from "../../../../src/core/state/migration";

/**
 * v7 -> v8 is the migration that makes the provider-neutral connection record
 * first class. The contract it has to keep:
 *
 * - a user who already configured OpenAI against a local broker does not have
 *   to re-enter anything;
 * - a user's consent decisions survive migration untouched;
 * - migration can never turn a stored production URL into a trusted connection;
 * - corrupt or hostile connection data is dropped, not propagated.
 */

function v7(settings: Record<string, unknown>): Record<string, unknown> {
  return { version: 7, profileRecords: {}, governanceProfiles: {}, settings };
}

describe("migration v7 to v8", () => {
  it("derives a loopback OpenAI connection from a configured v7 broker URL", () => {
    const result = migrate(
      v7({ llmProvider: "openai", openAiBaseUrl: "http://127.0.0.1:8787/__toneforge/llm" }),
    );

    const connection = result.providerConnections?.openai;
    expect(connection).toBeDefined();
    expect(connection?.provider).toBe("openai");
    expect(connection?.status).toBe("connected");
    expect(connection?.authMode).toBe("deploymentManaged");
    expect(connection?.baseOrigin?.classification).toBe("loopbackDevelopment");
    expect(connection?.baseOrigin?.origin).toBe("http://127.0.0.1:8787/__toneforge/llm");
  });

  it("carries the selected model onto the derived connection", () => {
    const result = migrate(
      v7({
        llmProvider: "openai",
        openAiBaseUrl: "http://localhost:8787",
        openAiModel: "gpt-4o-mini",
      }),
    );

    expect(result.providerConnections?.openai?.selectedModel).toBe("gpt-4o-mini");
  });

  it("classifies an OpenRouter connection as a broker-held API key", () => {
    const result = migrate(
      v7({
        llmProvider: "openrouter",
        openAiBaseUrl: "http://127.0.0.1:8787/__toneforge/gateway/v1",
      }),
    );

    expect(result.providerConnections?.openrouter?.authMode).toBe("brokerApiKey");
  });

  it("derives a connection for a non-OpenAI remote provider", () => {
    const result = migrate(
      v7({ llmProvider: "anthropic", openAiBaseUrl: "http://127.0.0.1:8787" }),
    );

    expect(result.providerConnections?.anthropic?.provider).toBe("anthropic");
  });

  it("derives nothing when the provider was the offline mock", () => {
    const result = migrate(v7({ llmProvider: "mock", openAiBaseUrl: "http://127.0.0.1:8787" }));

    expect(result.providerConnections).toEqual({});
  });

  it("derives nothing when no broker URL was configured", () => {
    const result = migrate(v7({ llmProvider: "openai" }));

    expect(result.providerConnections).toEqual({});
  });

  it("refuses to adopt a non-loopback origin through migration", () => {
    // A stored production URL is not a user decision about a live connection.
    // Migration must not launder one into a trusted `connected` record.
    const result = migrate(
      v7({ llmProvider: "openai", openAiBaseUrl: "https://api.openai.com/v1" }),
    );

    expect(result.providerConnections).toEqual({});
  });

  it("refuses a non-HTTP scheme on an otherwise loopback host", () => {
    const result = migrate(
      v7({ llmProvider: "openai", openAiBaseUrl: "file://localhost/etc/passwd" }),
    );

    expect(result.providerConnections).toEqual({});
  });

  it("preserves every consent decision", () => {
    const result = migrate(
      v7({
        llmProvider: "openai",
        openAiBaseUrl: "http://127.0.0.1:8787",
        semanticOptIn: true,
        fullDocumentReviewConsent: true,
        spotReviewConsent: true,
        telemetryDisabled: false,
      }),
    );

    expect(result.settings.semanticOptIn).toBe(true);
    expect(result.settings.fullDocumentReviewConsent).toBe(true);
    expect(result.settings.spotReviewConsent).toBe(true);
    expect(result.settings.telemetryDisabled).toBe(false);
  });

  it("keeps the provider selection when the broker URL is refused", () => {
    const result = migrate(
      v7({ llmProvider: "anthropic", openAiBaseUrl: "https://api.anthropic.com" }),
    );

    // The provider choice is a user preference and survives even though the
    // URL that would have made it usable did not.
    expect(result.settings.llmProvider).toBe("anthropic");
    expect(result.providerConnections).toEqual({});
  });

  it("reports the new current version", () => {
    const result = migrate(v7({ llmProvider: "mock" }));
    expect(result.version).toBe(CURRENT_STATE_VERSION);
  });

  it("strips a trailing slash so equivalent URLs produce one connection id", () => {
    const withSlash = migrate(
      v7({ llmProvider: "openai", openAiBaseUrl: "http://127.0.0.1:8787/api/" }),
    );
    const withoutSlash = migrate(
      v7({ llmProvider: "openai", openAiBaseUrl: "http://127.0.0.1:8787/api" }),
    );

    expect(withSlash.providerConnections?.openai?.connectionId).toBe(
      withoutSlash.providerConnections?.openai?.connectionId,
    );
  });

  it("survives a settings object that is not an object", () => {
    const result = migrate({ version: 7, settings: "corrupt" });

    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.providerConnections).toEqual({});
  });

  it("survives a missing settings object", () => {
    const result = migrate({ version: 7 });

    expect(result.version).toBe(CURRENT_STATE_VERSION);
    expect(result.providerConnections).toEqual({});
  });

  it("drops a connection filed under the wrong provider", () => {
    const result = migrate({
      version: 8,
      profileRecords: {},
      settings: { llmProvider: "openai" },
      providerConnections: {
        openrouter: {
          connectionId: "or_abc",
          provider: "openai",
          authMode: "brokerApiKey",
          status: "connected",
          baseOrigin: { origin: "http://127.0.0.1:8787", classification: "loopbackDevelopment" },
        },
      },
    });

    // The record claims to be `openai` while filed under `openrouter`. Accepting
    // it would let the registry build an adapter for a provider the user never
    // selected, so the mismatched pair is dropped entirely.
    expect(result.providerConnections).toEqual({});
  });

  it("keeps a well-formed connection whose key matches its provider", () => {
    const result = migrate({
      version: 8,
      profileRecords: {},
      settings: { llmProvider: "openrouter" },
      providerConnections: {
        openrouter: {
          connectionId: "or_abc",
          provider: "openrouter",
          authMode: "brokerApiKey",
          status: "connected",
          baseOrigin: { origin: "http://127.0.0.1:8787", classification: "loopbackDevelopment" },
        },
      },
    });

    expect(result.providerConnections?.openrouter?.connectionId).toBe("or_abc");
  });

  it("drops a structurally invalid connection", () => {
    const result = migrate({
      version: 8,
      profileRecords: {},
      settings: { llmProvider: "openai" },
      providerConnections: { openai: { connectionId: "", provider: "openai" } },
    });

    expect(result.providerConnections).toEqual({});
  });

  it("drops connections when the field is an array or a scalar", () => {
    expect(
      migrate({ version: 8, profileRecords: {}, providerConnections: [] }).providerConnections,
    ).toEqual({});
    expect(
      migrate({ version: 8, profileRecords: {}, providerConnections: "nope" }).providerConnections,
    ).toEqual({});
  });

  it("never carries a credential field through migration", () => {
    const result = migrate({
      version: 7,
      profileRecords: {},
      settings: {
        llmProvider: "openrouter",
        openAiBaseUrl: "http://127.0.0.1:8787",
        openAiApiKey: "sk-should-never-persist",
      },
    });

    // The v7 settings carried a browser-held key. Migration must not copy it
    // into the connection record, which is the whole point of v8.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sk-should-never-persist");
  });
});
