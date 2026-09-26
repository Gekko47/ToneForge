import { describe, expect, it } from "vitest";
import {
  AUTHORIZATION_ATTEMPT_TTL_MS,
  AuthorizationAttemptSchema,
  createAuthorizationState,
  authorizationReducer,
  canStartOAuth,
  describeAuthorizationError,
  oauthSupportFor,
  resolveAuthMode,
  toConnectionStatus,
  validateCallback,
} from "../../../../src/ai/gateway/oauthState";
import {
  ProviderConnectionSchema,
  type ProviderId,
} from "../../../../src/core/domain/ProviderConnection";

const REDIRECT_ORIGIN = "https://localhost:3000";
const NOW = "2026-09-26T10:00:00.000Z";

function attempt(overrides: Partial<Record<string, unknown>> = {}) {
  return AuthorizationAttemptSchema.parse({
    attemptId: "attempt_1",
    provider: "anthropic",
    redirectOrigin: REDIRECT_ORIGIN,
    state: "opaque-state-value",
    nonce: "opaque-nonce-value",
    startedAt: NOW,
    ...overrides,
  });
}

function connection(provider: ProviderId = "anthropic") {
  return ProviderConnectionSchema.parse({
    connectionId: "conn_1",
    provider,
    authMode: "oauth",
    status: "connected",
  });
}

function callbackUrl(params: Record<string, string>, origin = REDIRECT_ORIGIN): string {
  const url = new URL("/oauth/callback", origin);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

describe("provider OAuth qualification", () => {
  it("treats Anthropic developer OAuth as supported", () => {
    expect(oauthSupportFor("anthropic")).toBe("supported");
    expect(canStartOAuth("anthropic", false)).toBe(true);
  });

  it("keeps general OpenAI user OAuth feature-gated until officially approved", () => {
    expect(oauthSupportFor("openai")).toBe("featureGated");
    expect(canStartOAuth("openai", false)).toBe(false);
  });

  it("allows OpenAI OAuth only behind an explicit deployment approval", () => {
    expect(canStartOAuth("openai", true)).toBe(true);
  });

  it("never offers OAuth for OpenRouter, which uses a one-time API key", () => {
    expect(oauthSupportFor("openrouter")).toBe("unsupported");
    expect(canStartOAuth("openrouter", true)).toBe(false);
  });

  it("has no authentication at all for the offline mock provider", () => {
    expect(oauthSupportFor("mock")).toBe("notApplicable");
    expect(canStartOAuth("mock", true)).toBe(false);
  });
});

describe("resolveAuthMode", () => {
  it("uses OAuth for Anthropic without needing any approval flag", () => {
    expect(resolveAuthMode("anthropic", false)).toBe("oauth");
  });

  it("uses a deployment-managed connection for OpenAI while OAuth is unapproved", () => {
    // This is the honesty requirement: OpenAI must not present a sign-in
    // button that cannot complete, and must never relabel an API key or a
    // ChatGPT subscription login as "OpenAI OAuth".
    expect(resolveAuthMode("openai", false)).toBe("deploymentManaged");
  });

  it("switches OpenAI to OAuth only once officially approved", () => {
    expect(resolveAuthMode("openai", true)).toBe("oauth");
  });

  it("uses a broker API key for OpenRouter", () => {
    expect(resolveAuthMode("openrouter", false)).toBe("brokerApiKey");
  });

  it("uses no authentication for the mock provider", () => {
    expect(resolveAuthMode("mock", false)).toBe("none");
  });
});

describe("validateCallback", () => {
  it("accepts a matching state, nonce, origin, and fresh attempt", () => {
    const url = callbackUrl({ state: "opaque-state-value", nonce: "opaque-nonce-value" });
    expect(validateCallback(attempt(), url, new Date(NOW))).toBeNull();
  });

  it("refuses a callback from an unexpected origin", () => {
    const url = callbackUrl(
      { state: "opaque-state-value", nonce: "opaque-nonce-value" },
      "https://evil.example",
    );
    expect(validateCallback(attempt(), url, new Date(NOW))).toBe("originMismatch");
  });

  it("refuses an unparseable callback URL", () => {
    expect(validateCallback(attempt(), "not a url", new Date(NOW))).toBe("originMismatch");
  });

  it("refuses a mismatched state", () => {
    const url = callbackUrl({ state: "forged", nonce: "opaque-nonce-value" });
    expect(validateCallback(attempt(), url, new Date(NOW))).toBe("stateMismatch");
  });

  it("refuses a missing state", () => {
    const url = callbackUrl({ nonce: "opaque-nonce-value" });
    expect(validateCallback(attempt(), url, new Date(NOW))).toBe("stateMismatch");
  });

  it("refuses a mismatched nonce", () => {
    const url = callbackUrl({ state: "opaque-state-value", nonce: "forged" });
    expect(validateCallback(attempt(), url, new Date(NOW))).toBe("nonceMismatch");
  });

  it("refuses an expired attempt", () => {
    const url = callbackUrl({ state: "opaque-state-value", nonce: "opaque-nonce-value" });
    const tooLate = new Date(new Date(NOW).getTime() + AUTHORIZATION_ATTEMPT_TTL_MS + 1000);
    expect(validateCallback(attempt(), tooLate.toISOString() && url, tooLate)).toBe(
      "expiredAttempt",
    );
  });
});

describe("authorizationReducer", () => {
  it("starts idle with no attempt", () => {
    const state = createAuthorizationState();
    expect(state.status).toBe("idle");
    expect(state.attempt).toBeNull();
  });

  it("records a started attempt", () => {
    const state = authorizationReducer(createAuthorizationState(), {
      type: "start",
      attempt: attempt(),
    });
    expect(state.status).toBe("startAuthorization");
    expect(state.attempt?.state).toBe("opaque-state-value");
  });

  it("connects on a valid callback and consumes the attempt", () => {
    const started = authorizationReducer(createAuthorizationState(), {
      type: "start",
      attempt: attempt(),
    });
    const done = authorizationReducer(started, {
      type: "callback",
      callbackUrl: callbackUrl({ state: "opaque-state-value", nonce: "opaque-nonce-value" }),
      connection: connection(),
      now: NOW,
    });
    expect(done.status).toBe("connected");
    expect(done.connection?.connectionId).toBe("conn_1");
    // The attempt is consumed, so the same state cannot be replayed.
    expect(done.attempt).toBeNull();
  });

  it("refuses a replayed callback after a successful one", () => {
    const started = authorizationReducer(createAuthorizationState(), {
      type: "start",
      attempt: attempt(),
    });
    const url = callbackUrl({ state: "opaque-state-value", nonce: "opaque-nonce-value" });
    const done = authorizationReducer(started, {
      type: "callback",
      callbackUrl: url,
      connection: connection(),
      now: NOW,
    });
    const replayed = authorizationReducer(done, {
      type: "callback",
      callbackUrl: url,
      connection: connection(),
      now: NOW,
    });
    expect(replayed.status).toBe("failed");
    expect(replayed.errorCode).toBe("alreadyConsumed");
  });

  it("consumes the attempt even when the callback is refused, forcing a fresh start", () => {
    const started = authorizationReducer(createAuthorizationState(), {
      type: "start",
      attempt: attempt(),
    });
    const refused = authorizationReducer(started, {
      type: "callback",
      callbackUrl: callbackUrl({ state: "forged", nonce: "forged" }),
      connection: connection(),
      now: NOW,
    });
    expect(refused.status).toBe("failed");
    expect(refused.errorCode).toBe("stateMismatch");
    expect(refused.attempt).toBeNull();
    expect(refused.connection).toBeNull();
  });

  it("refuses a callback when no attempt is pending", () => {
    const result = authorizationReducer(createAuthorizationState(), {
      type: "callback",
      callbackUrl: callbackUrl({ state: "x", nonce: "y" }),
      connection: connection(),
      now: NOW,
    });
    expect(result.errorCode).toBe("alreadyConsumed");
  });

  it("refuses a connection whose provider differs from the attempt", () => {
    const started = authorizationReducer(createAuthorizationState(), {
      type: "start",
      attempt: attempt(),
    });
    const result = authorizationReducer(started, {
      type: "callback",
      callbackUrl: callbackUrl({ state: "opaque-state-value", nonce: "opaque-nonce-value" }),
      connection: connection("openrouter"),
      now: NOW,
    });
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("providerRefused");
  });

  it("records an explicit failure and clears the attempt", () => {
    const result = authorizationReducer(createAuthorizationState(), {
      type: "fail",
      errorCode: "providerUnsupported",
    });
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("providerUnsupported");
  });

  it("resets to idle", () => {
    const failed = authorizationReducer(createAuthorizationState(), {
      type: "fail",
      errorCode: "stateMismatch",
    });
    expect(authorizationReducer(failed, { type: "reset" })).toEqual(createAuthorizationState());
  });
});

describe("toConnectionStatus", () => {
  it("maps each flow state onto the persisted connection lifecycle", () => {
    expect(toConnectionStatus(createAuthorizationState())).toBe("disconnected");
    expect(
      toConnectionStatus(
        authorizationReducer(createAuthorizationState(), { type: "start", attempt: attempt() }),
      ),
    ).toBe("startAuthorization");
    expect(
      toConnectionStatus(
        authorizationReducer(createAuthorizationState(), {
          type: "fail",
          errorCode: "stateMismatch",
        }),
      ),
    ).toBe("failed");
  });

  it("uses the connected record's own status once connected", () => {
    const started = authorizationReducer(createAuthorizationState(), {
      type: "start",
      attempt: attempt(),
    });
    const done = authorizationReducer(started, {
      type: "callback",
      callbackUrl: callbackUrl({ state: "opaque-state-value", nonce: "opaque-nonce-value" }),
      connection: connection(),
      now: NOW,
    });
    expect(toConnectionStatus(done)).toBe("connected");
  });
});

describe("describeAuthorizationError", () => {
  it("returns an empty string for no error", () => {
    expect(describeAuthorizationError("none")).toBe("");
  });

  it("returns a distinct plain-language message for every refusal reason", () => {
    const codes = [
      "providerUnsupported",
      "stateMismatch",
      "nonceMismatch",
      "originMismatch",
      "expiredAttempt",
      "alreadyConsumed",
      "providerRefused",
    ] as const;
    const messages = codes.map(describeAuthorizationError);
    expect(messages.every((message) => message.length > 0)).toBe(true);
    // Distinct messages: the user must be able to tell the refusals apart.
    expect(new Set(messages).size).toBe(codes.length);
  });

  it("never leaks a credential in a refusal message", () => {
    const messages = [
      "providerUnsupported",
      "stateMismatch",
      "nonceMismatch",
      "originMismatch",
      "expiredAttempt",
      "alreadyConsumed",
      "providerRefused",
    ]
      .map((code) => describeAuthorizationError(code as never))
      .join(" ");
    expect(messages).not.toMatch(/sk-|pk-|rk-|whsec_|bearer/i);
  });
});

describe("no browser-held credentials", () => {
  it("keeps PKCE verifiers and client secrets out of the attempt contract", () => {
    const fields = Object.keys(AuthorizationAttemptSchema.shape);
    const forbidden = /verifier|secret|code|token|refresh|access/i;
    expect(fields.filter((field) => forbidden.test(field))).toEqual([]);
  });

  it("keeps a full authorization-state record free of secret-shaped fields", () => {
    const fields = Object.keys(createAuthorizationState() as unknown as Record<string, unknown>);
    const forbidden = /verifier|secret|token|password|key/i;
    expect(fields.filter((field) => forbidden.test(field))).toEqual([]);
  });
});
