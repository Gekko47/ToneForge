import { describe, expect, it, vi } from "vitest";

// Mock env before importing providerComposition, which reads env at call time.
vi.mock("../../../src/core/config/env", () => ({
  env: {
    OPENAI_TIMEOUT_MS: 30000,
    OPENAI_MAX_RETRIES: 2,
    LLM_BROKER_URL: "https://localhost:3000",
  },
}));

import { ProviderConnectionSchema } from "../../../src/core/domain/ProviderConnection";
import { LlmRoleBindingSchema } from "../../../src/core/domain/LlmRole";
import type { PersistedState } from "../../../src/core/state/persistence";
import { setupStatusFromState } from "../../../src/taskpane/setupStatus";

function connection(id: string, overrides: Record<string, unknown> = {}) {
  return ProviderConnectionSchema.parse({
    connectionId: id,
    provider: "openrouter",
    authMode: "brokerApiKey",
    status: "connected",
    ...overrides,
  });
}

function binding(connectionId: string, overrides: Record<string, unknown> = {}) {
  return LlmRoleBindingSchema.parse({
    role: "general",
    provider: "openrouter",
    connectionId,
    ...overrides,
  });
}

/**
 * The state the dashboard's connect path actually produces.
 *
 * `SettingsDashboard.handleConnect` writes a role binding and a connection and
 * never touches `settings.llmProvider`, which stays `"mock"` — the legacy field
 * is only written by the older `applyLlmDraft` settings form. So this is the
 * shape a user has after connecting through the role cards, and it is the shape
 * the setup checklist must read.
 */
function connectedState(): PersistedState {
  return {
    activeProfileId: "profile-1",
    activeSemanticProfileId: "semantic-1",
    settings: {
      llmProvider: "mock",
      openAiCredentialMode: "broker",
      semanticOptIn: true,
      consistencyReviewConsent: true,
    },
    llmRoleBindings: { general: binding("or_4db5a773268690659870f901550f0d2a") },
    providerConnections: {
      or_4db5a773268690659870f901550f0d2a: connection("or_4db5a773268690659870f901550f0d2a"),
    },
  } as unknown as PersistedState;
}

describe("setupStatusFromState", () => {
  it("reports the AI provider as ready when a role binding resolves a connected connection", () => {
    // The dashboard's connect path writes a binding and a connection and leaves
    // `settings.llmProvider` at "mock". Reading only that legacy field reported
    // a working connection as missing, so Home and the LLM-settings header
    // contradicted the role cards and the review gates that had already opened.
    const status = setupStatusFromState(connectedState());
    const provider = status.items.find((item) => item.id === "llmProvider");

    expect(provider?.ready).toBe(true);
    expect(provider?.blocked).toBeNull();
  });

  it("still reports the AI provider as missing when no role is bound", () => {
    const state = connectedState();
    const status = setupStatusFromState({
      ...state,
      llmRoleBindings: {},
      providerConnections: {},
    } as unknown as PersistedState);

    const provider = status.items.find((item) => item.id === "llmProvider");
    expect(provider?.ready).toBe(false);
    expect(provider?.blocked).toMatch(/provider is connected/i);
  });

  it("reports the AI provider as missing when the bound connection is not connected", () => {
    const state = connectedState();
    const status = setupStatusFromState({
      ...state,
      providerConnections: {
        or_4db5a773268690659870f901550f0d2a: connection("or_4db5a773268690659870f901550f0d2a", {
          status: "disconnected",
        }),
      },
    } as unknown as PersistedState);

    const provider = status.items.find((item) => item.id === "llmProvider");
    expect(provider?.ready).toBe(false);
  });

  it("keeps a pre-v15 store working through the legacy provider field", () => {
    // No general binding exists, so the role-aware check falls back to the
    // legacy single-connection path rather than reporting a configured store
    // as missing.
    const status = setupStatusFromState({
      activeProfileId: "profile-1",
      activeSemanticProfileId: "semantic-1",
      settings: {
        llmProvider: "openrouter",
        openAiCredentialMode: "broker",
        semanticOptIn: true,
        consistencyReviewConsent: true,
      },
      providerConnections: {
        "local:openrouter:https://localhost:3000": connection(
          "local:openrouter:https://localhost:3000",
        ),
      },
    } as unknown as PersistedState);

    const provider = status.items.find((item) => item.id === "llmProvider");
    expect(provider?.ready).toBe(true);
  });
});
