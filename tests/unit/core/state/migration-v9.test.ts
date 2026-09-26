import { describe, expect, it } from "vitest";
import { CURRENT_STATE_VERSION, migrate } from "../../../../src/core/state/migration";

/**
 * The v8 -> v9 step adds the consistency engine's own consent.
 *
 * Every assertion here is about one thing: a user who never saw that control
 * must not end up with it on. The field is what gates whether a whole document
 * may be sent to a non-deterministic engine, so an inherited value here would be
 * the one inheritance that matters.
 */

function v8(settings: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 8,
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

describe("migration v8 to v9", () => {
  it("lands on the current version", () => {
    expect(migrate(v8()).version).toBe(CURRENT_STATE_VERSION);
  });

  it("adds the consistency consent, switched off", () => {
    expect(migrate(v8()).settings.consistencyReviewConsent).toBe(false);
  });

  it("does not inherit it from the full-document review consent", () => {
    // The whole reason this is a third flag. A user who agreed to a whole
    // document style review has not agreed to a whole document pairwise
    // self-comparison by a non-deterministic engine.
    const result = migrate(v8({ fullDocumentReviewConsent: true }));
    expect(result.settings.fullDocumentReviewConsent).toBe(true);
    expect(result.settings.consistencyReviewConsent).toBe(false);
  });

  it("does not inherit it from the semantic opt-in", () => {
    const result = migrate(v8({ semanticOptIn: true }));
    expect(result.settings.semanticOptIn).toBe(true);
    expect(result.settings.consistencyReviewConsent).toBe(false);
  });

  it("does not inherit it from a consent that is merely truthy", () => {
    // A stored non-boolean must read as a refusal, not as permission.
    ["yes", 1, "true", {}, []].forEach((value) => {
      const result = migrate(v8({ consistencyReviewConsent: value }));
      expect(result.settings.consistencyReviewConsent).toBe(false);
    });
  });

  it("revokes rather than honours a consent already present on a v8 record", () => {
    // v8 predates the control, so nothing in a v8 record could have been an
    // answer to the question it asks. A stray `true` there is not a decision, and
    // the two error directions are not symmetric: silently dropping a consent
    // the user gave is an inconvenience, silently granting one is a breach.
    expect(migrate(v8({ consistencyReviewConsent: true })).settings.consistencyReviewConsent).toBe(
      false,
    );
  });

  it("preserves every other v8 setting", () => {
    const result = migrate(
      v8({
        llmProvider: "openai",
        spotReviewConsent: true,
        fullDocumentReviewConsent: true,
        semanticOptIn: true,
        telemetryDisabled: false,
        openAiModel: "gpt-4o",
      }),
    );
    expect(result.settings.llmProvider).toBe("openai");
    expect(result.settings.spotReviewConsent).toBe(true);
    expect(result.settings.fullDocumentReviewConsent).toBe(true);
    expect(result.settings.semanticOptIn).toBe(true);
    expect(result.settings.telemetryDisabled).toBe(false);
    expect(result.settings.openAiModel).toBe("gpt-4o");
  });

  it("preserves a stored provider connection", () => {
    const result = migrate({
      ...v8(),
      providerConnections: {
        openai: {
          connectionId: "local:openai:http://127.0.0.1:8787",
          provider: "openai",
          authMode: "deploymentManaged",
          status: "connected",
          baseOrigin: { origin: "http://127.0.0.1:8787", classification: "loopbackDevelopment" },
        },
      },
    });
    expect(result.providerConnections?.openai?.status).toBe("connected");
  });

  it("reads a current v9 state without resetting the consent", () => {
    // The migration chain runs on every load, so a v9 record that came back
    // through `readCurrentState` must keep what the user actually chose. Only a
    // v8 record is forced to false; a v9 record is a user's real answer.
    const current = {
      ...migrate(v8()),
      version: CURRENT_STATE_VERSION,
      settings: { ...migrate(v8()).settings, consistencyReviewConsent: true },
    };
    expect(migrate(current).settings.consistencyReviewConsent).toBe(true);
  });

  it("gives a default state the consent switched off", () => {
    expect(migrate(null).settings.consistencyReviewConsent).toBe(false);
  });
});
