/**
 * OAuth client state machine (Phase 4).
 *
 * The add-in never runs the authorization-code exchange itself. The production
 * gateway owns the client secret, the token exchange, encryption at rest, and
 * refresh. This module owns only what the browser legitimately must hold: the
 * user's progress through a flow and the validation of what comes back.
 *
 * Design rules, each enforced by a test:
 *
 * 1. **No PKCE verifier and no client secret are ever generated, held, or
 *    transmitted here.** Both live server-side. The browser receives an opaque
 *    connection reference and non-secret metadata. A verifier in the bundle
 *    would be a verifier in every user's browser.
 * 2. **A fresh authorization cannot reuse stale state.** `state` and `nonce`
 *    are validated per attempt and are consumed on use, so a replayed callback
 *    is rejected rather than accepted twice.
 * 3. **A callback is only accepted from the expected redirect origin.** An
 *    unexpected origin is refused outright.
 * 4. **Unsupported OAuth is never presented as a working option.** OpenAI's
 *    general end-user OAuth is not officially established, so it stays
 *    feature-gated off and OpenAI uses a deployment-managed connection. A
 *    ChatGPT subscription login, an MCP connector, workload identity, or an API
 *    key is never relabelled as "OpenAI OAuth".
 *
 * Pure functions only: no network, no storage, no Office, no UI.
 */

import { z } from "zod";
import {
  ProviderConnectionSchema,
  type ConnectionStatus,
  type ProviderConnection,
  type ProviderId,
} from "../../core/domain/ProviderConnection";

/** How a provider supports end-user authentication, per the approved plan. */
export type OAuthSupport = "supported" | "featureGated" | "unsupported" | "notApplicable";

/**
 * Provider OAuth qualification.
 *
 * - Anthropic: developer/Console OAuth with authorization-code + PKCE and
 *   refresh-token support where officially enabled.
 * - OpenAI: official API documentation confirms API-key and workload-identity
 *   authentication for ordinary model requests, not a general third-party
 *   end-user OAuth equivalent. It therefore stays feature-gated and uses a
 *   deployment-managed connection.
 * - OpenRouter: API key submitted once through the broker; no end-user OAuth.
 * - Mock: offline; no authentication at all.
 */
export const PROVIDER_OAUTH_SUPPORT: Readonly<Record<ProviderId, OAuthSupport>> = Object.freeze({
  anthropic: "supported",
  openai: "featureGated",
  openrouter: "unsupported",
  mock: "notApplicable",
});

export function oauthSupportFor(provider: ProviderId): OAuthSupport {
  return PROVIDER_OAUTH_SUPPORT[provider];
}

/** True only when the provider's OAuth flow may be started right now. */
export function canStartOAuth(provider: ProviderId, openAiOAuthApproved: boolean): boolean {
  const support = oauthSupportFor(provider);
  if (support === "supported") return true;
  // The one sanctioned exception: OpenAI user OAuth may be enabled only after
  // official registration and a verified production flow, both of which are
  // deployment decisions rather than user settings.
  if (support === "featureGated") return openAiOAuthApproved;
  return false;
}

/**
 * The authentication mode a provider connection should actually use.
 *
 * This is what keeps the UI honest: a user selecting OpenAI gets a
 * deployment-managed connection, not a sign-in button that cannot work.
 */
export function resolveAuthMode(
  provider: ProviderId,
  openAiOAuthApproved: boolean,
): "oauth" | "deploymentManaged" | "brokerApiKey" | "none" {
  if (provider === "mock") return "none";
  if (canStartOAuth(provider, openAiOAuthApproved)) return "oauth";
  if (provider === "openrouter") return "brokerApiKey";
  return "deploymentManaged";
}

/** Per-attempt authorization parameters. Contains no secret. */
export const AuthorizationAttemptSchema = z.object({
  attemptId: z.string().trim().min(1),
  provider: z.enum(["openai", "anthropic", "openrouter", "mock"]),
  /** Expected redirect origin for the callback, e.g. the add-in's own origin. */
  redirectOrigin: z.string().trim().min(1),
  /** Opaque, single-use CSRF value issued by the gateway. */
  state: z.string().trim().min(1),
  /** Opaque, single-use replay guard issued by the gateway. */
  nonce: z.string().trim().min(1),
  startedAt: z.string().datetime(),
});
export type AuthorizationAttempt = z.infer<typeof AuthorizationAttemptSchema>;

/**
 * Authorization flow state held by the task pane.
 *
 * The attempt is retained so the callback can be validated, and is dropped as
 * soon as it is consumed so a second callback cannot be accepted.
 */
export const AuthorizationStateSchema = z.object({
  status: z.enum(["idle", "startAuthorization", "callback", "connected", "failed"]),
  attempt: AuthorizationAttemptSchema.nullable().default(null),
  connection: ProviderConnectionSchema.nullable().default(null),
  /** Safe, user-presentable reason. Never an authorization code or token. */
  errorCode: z
    .enum([
      "none",
      "providerUnsupported",
      "stateMismatch",
      "nonceMismatch",
      "originMismatch",
      "expiredAttempt",
      "alreadyConsumed",
      "providerRefused",
    ])
    .default("none"),
});
export type AuthorizationState = z.infer<typeof AuthorizationStateSchema>;

/** How long an authorization attempt stays valid. */
export const AUTHORIZATION_ATTEMPT_TTL_MS = 10 * 60 * 1000;

export function createAuthorizationState(): AuthorizationState {
  return AuthorizationStateSchema.parse({
    status: "idle",
    attempt: null,
    connection: null,
    errorCode: "none",
  });
}

export type AuthorizationAction =
  | { type: "start"; attempt: AuthorizationAttempt }
  | { type: "callback"; callbackUrl: string; connection: ProviderConnection; now: string }
  | { type: "fail"; errorCode: AuthorizationState["errorCode"] }
  | { type: "reset" };

/**
 * Validate a callback URL's parameters against the pending attempt.
 *
 * Returns the reason the callback must be refused, or null when it is valid.
 * The comparison is exact and case-sensitive because `state` and `nonce` are
 * opaque gateway-issued values, not user-facing text.
 */
export function validateCallback(
  attempt: AuthorizationAttempt,
  callbackUrl: string,
  now: Date,
): AuthorizationState["errorCode"] | null {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    return "originMismatch";
  }

  let origin: string;
  try {
    origin = new URL(attempt.redirectOrigin).origin;
  } catch {
    return "originMismatch";
  }
  if (url.origin !== origin) return "originMismatch";

  const returnedState = url.searchParams.get("state");
  if (returnedState === null) return "stateMismatch";
  if (returnedState !== attempt.state) return "stateMismatch";

  const returnedNonce = url.searchParams.get("nonce");
  if (returnedNonce === null) return "nonceMismatch";
  if (returnedNonce !== attempt.nonce) return "nonceMismatch";

  const started = new Date(attempt.startedAt).getTime();
  if (Number.isNaN(started) || now.getTime() - started > AUTHORIZATION_ATTEMPT_TTL_MS) {
    return "expiredAttempt";
  }
  return null;
}

/**
 * Pure reducer for the authorization flow.
 *
 * A callback is accepted only when `validateCallback` passes. The attempt is
 * consumed either way, so a rejected callback cannot be retried against the
 * same `state` — the user must start a fresh authorization.
 */
export function authorizationReducer(
  state: AuthorizationState,
  action: AuthorizationAction,
): AuthorizationState {
  switch (action.type) {
    case "start":
      return AuthorizationStateSchema.parse({
        status: "startAuthorization",
        attempt: action.attempt,
        connection: null,
        errorCode: "none",
      });
    case "callback": {
      if (!state.attempt) {
        // No pending attempt: the callback is unsolicited or already consumed.
        return AuthorizationStateSchema.parse({
          status: "failed",
          attempt: null,
          connection: null,
          errorCode: "alreadyConsumed",
        });
      }
      const reason = validateCallback(state.attempt, action.callbackUrl, new Date(action.now));
      if (reason !== null) {
        // Drop the attempt so this `state` cannot be replayed.
        return AuthorizationStateSchema.parse({
          status: "failed",
          attempt: null,
          connection: null,
          errorCode: reason,
        });
      }
      if (action.connection.provider !== state.attempt.provider) {
        return AuthorizationStateSchema.parse({
          status: "failed",
          attempt: null,
          connection: null,
          errorCode: "providerRefused",
        });
      }
      return AuthorizationStateSchema.parse({
        status: "connected",
        attempt: null,
        connection: action.connection,
        errorCode: "none",
      });
    }
    case "fail":
      return AuthorizationStateSchema.parse({
        status: "failed",
        attempt: null,
        connection: null,
        errorCode: action.errorCode,
      });
    case "reset":
      return createAuthorizationState();
  }
}

/** Map a flow state onto the persisted connection lifecycle status. */
export function toConnectionStatus(state: AuthorizationState): ConnectionStatus {
  if (state.status === "connected" && state.connection) return state.connection.status;
  switch (state.status) {
    case "startAuthorization":
      return "startAuthorization";
    case "callback":
      return "callback";
    case "failed":
      return "failed";
    default:
      return "disconnected";
  }
}

/** Plain-language reason for each refusal, for the task pane. */
export function describeAuthorizationError(code: AuthorizationState["errorCode"]): string {
  switch (code) {
    case "none":
      return "";
    case "providerUnsupported":
      return "This provider does not offer a supported sign-in for ToneForge.";
    case "stateMismatch":
      return "The sign-in could not be verified. Start the connection again.";
    case "nonceMismatch":
      return "The sign-in response could not be verified. Start the connection again.";
    case "originMismatch":
      return "The sign-in response came from an unexpected source and was refused.";
    case "expiredAttempt":
      return "The sign-in took too long. Start the connection again.";
    case "alreadyConsumed":
      return "That sign-in response was already used. Start the connection again.";
    case "providerRefused":
      return "The provider did not approve this connection.";
  }
}
