import { describe, expect, it } from "vitest";
import { CURRENT_STATE_VERSION, migrate } from "../../../../src/core/state/migration";

/**
 * The v9 -> v10 step removes three settings that never changed anything.
 *
 * `spotReviewConsent` and `fullDocumentReviewConsent` gated the Phase D and
 * Phase E review engines, which are gone (ADR-0059). `telemetryDisabled` toggled
 * a UI switch over a build-time env flag with no analytics endpoint configured
 * (ADR-0060). Each was a control a user could operate and observe no effect in.
 *
 * Two things matter here and they are not the same thing. A v9 user must not
 * lose their provider connection or their AI Review consent — those are real
 * decisions. And the removed fields must not survive as invisible data that
 * could be read back as if a retired engine were still gated.
 */

function v9(settings: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 9,
    profileRecords: {},
    activeProfileId: null,
    governanceProfiles: {},
    governanceHistory: {},
    activeGovernanceProfileId: null,
    providerConnections: {},
    settings: {
      llmProvider: "mock",
      openAiCredentialMode: "broker",
      spotReviewConsent: false,
      fullDocumentReviewConsent: false,
      telemetryDisabled: true,
      semanticOptIn: false,
      ...settings,
    },
  };
}

describe("migration v9 to v10", () => {
  it("lands on the current version", () => {
    expect(migrate(v9()).version).toBe(CURRENT_STATE_VERSION);
  });

  it("drops the two retired review consents and the telemetry flag", () => {
    const result = migrate(v9({ spotReviewConsent: true, fullDocumentReviewConsent: true }));
    expect(result.settings).not.toHaveProperty("spotReviewConsent");
    expect(result.settings).not.toHaveProperty("fullDocumentReviewConsent");
    expect(result.settings).not.toHaveProperty("telemetryDisabled");
  });

  it("drops them even when they were the only settings a user had set", () => {
    // A stored `true` must not be laundered into a v10 field, and must not
    // become a silent permission for anything else on the way through.
    const result = migrate(v9({ spotReviewConsent: true, fullDocumentReviewConsent: true }));
    expect(result.settings.consistencyReviewConsent).toBe(false);
    expect(result.settings.semanticOptIn).toBe(false);
  });

  it("preserves the provider selection and the consents that still mean something", () => {
    const result = migrate(
      v9({
        llmProvider: "openrouter",
        semanticOptIn: true,
        consistencyReviewConsent: true,
        openAiModel: "anthropic/claude-sonnet-4",
        openAiBaseUrl: "https://openrouter.ai/api/v1",
      }),
    );
    expect(result.settings.llmProvider).toBe("openrouter");
    expect(result.settings.semanticOptIn).toBe(true);
    expect(result.settings.consistencyReviewConsent).toBe(true);
    expect(result.settings.openAiModel).toBe("anthropic/claude-sonnet-4");
    expect(result.settings.openAiBaseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("preserves a stored provider connection, re-keyed to its connectionId", () => {
    const result = migrate({
      ...v9(),
      providerConnections: {
        openrouter: {
          connectionId: "broker:openrouter:https://openrouter.ai/api/v1",
          provider: "openrouter",
          authMode: "brokerApiKey",
          status: "connected",
          baseOrigin: { origin: "https://openrouter.ai", classification: "deploymentDefault" },
        },
      },
    });
    expect(
      result.providerConnections?.["broker:openrouter:https://openrouter.ai/api/v1"]?.status,
    ).toBe("connected");
  });

  it("leaves a v10 store alone", () => {
    const current = { ...migrate(v9()), version: CURRENT_STATE_VERSION };
    const result = migrate(current);
    expect(result).toEqual(current);
  });
});
