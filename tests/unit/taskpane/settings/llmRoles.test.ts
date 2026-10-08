import { describe, expect, it, vi } from "vitest";

// Mock env before importing providerComposition, which reads env at call time.
vi.mock("../../../../src/core/config/env", () => ({
  env: {
    OPENAI_TIMEOUT_MS: 30000,
    OPENAI_MAX_RETRIES: 2,
    LLM_BROKER_URL: "https://localhost:3000",
  },
}));

import { ProviderConnectionSchema } from "../../../../src/core/domain/ProviderConnection";
import { LlmRoleBindingSchema, LlmRoleBindingsSchema } from "../../../../src/core/domain/LlmRole";
import type { PersistedState } from "../../../../src/core/state/persistence";
import {
  connectionsById,
  effectivePurpose,
  isRoleConfigured,
  isValidPurpose,
  removeRoleBinding,
  resolveRoleBinding,
  setReuseGeneral,
  setRoleBinding,
} from "../../../../src/taskpane/settings/llmRoles";
import {
  createRegistryForRole,
  decisionProviderFromState,
  generalProviderFromState,
  isDecisionRoleConfigured,
  isGeneralRoleConfigured,
} from "../../../../src/taskpane/settings/providerComposition";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function connection(
  id: string,
  provider: "openai" | "anthropic" | "openrouter",
  overrides: Record<string, unknown> = {},
) {
  return ProviderConnectionSchema.parse({
    connectionId: id,
    provider,
    authMode: provider === "openrouter" ? "brokerApiKey" : "deploymentManaged",
    status: "connected",
    ...overrides,
  });
}

function binding(
  role: "general" | "consistency_decision",
  connectionId: string,
  overrides: Record<string, unknown> = {},
) {
  return LlmRoleBindingSchema.parse({
    role,
    provider: "openai",
    connectionId,
    ...overrides,
  });
}

function makeState(overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    settings: {
      llmProvider: "openai",
      openAiBaseUrl: "",
      openAiModel: "gpt-4",
      autoScan: true,
      consistencyReviewConsent: false,
      semanticOptIn: false,
      decisionFallbackPolicy: "unresolved",
    },
    llmRoleBindings: {},
    providerConnections: {},
    ...overrides,
  } as PersistedState;
}

// ---------------------------------------------------------------------------
// resolveRoleBinding
// ---------------------------------------------------------------------------

describe("resolveRoleBinding", () => {
  it("returns undefined when bindings are undefined", () => {
    expect(resolveRoleBinding(undefined, "general")).toBeUndefined();
  });

  it("returns undefined when the role is not bound", () => {
    const bindings = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
    });
    expect(resolveRoleBinding(bindings, "consistency_decision")).toBeUndefined();
  });

  it("returns the binding for the requested role", () => {
    const bindings = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
      consistency_decision: {
        role: "consistency_decision",
        provider: "anthropic",
        connectionId: "c2",
      },
    });
    const result = resolveRoleBinding(bindings, "consistency_decision");
    expect(result).toBeDefined();
    expect(result?.connectionId).toBe("c2");
  });
});

// ---------------------------------------------------------------------------
// isRoleConfigured
// ---------------------------------------------------------------------------

describe("isRoleConfigured", () => {
  it("returns false when binding is undefined", () => {
    expect(isRoleConfigured(undefined, {})).toBe(false);
  });

  it("returns false when the connection does not exist", () => {
    const b = binding("general", "missing");
    expect(isRoleConfigured(b, {})).toBe(false);
  });

  it("returns false when the connection is disconnected", () => {
    const b = binding("general", "c1");
    const conns = { c1: connection("c1", "openai", { status: "disconnected" }) };
    expect(isRoleConfigured(b, conns)).toBe(false);
  });

  it("returns true when the connection exists and is connected", () => {
    const b = binding("general", "c1");
    const conns = { c1: connection("c1", "openai") };
    expect(isRoleConfigured(b, conns)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// effectivePurpose
// ---------------------------------------------------------------------------

describe("effectivePurpose", () => {
  it("returns the default purpose for general when unspecified", () => {
    expect(effectivePurpose("general", undefined)).toBe("consistency_extraction");
  });

  it("returns the default purpose for consistency_decision when unspecified", () => {
    expect(effectivePurpose("consistency_decision", undefined)).toBe("consistency_decision");
  });

  it("returns the explicit purpose when specified", () => {
    expect(effectivePurpose("general", "semantic_review")).toBe("semantic_review");
  });
});

// ---------------------------------------------------------------------------
// isValidPurpose
// ---------------------------------------------------------------------------

describe("isValidPurpose", () => {
  it("accepts semantic_review for general", () => {
    expect(isValidPurpose("general", "semantic_review")).toBe(true);
  });

  it("accepts consistency_extraction for general", () => {
    expect(isValidPurpose("general", "consistency_extraction")).toBe(true);
  });

  it("rejects consistency_decision for general", () => {
    expect(isValidPurpose("general", "consistency_decision")).toBe(false);
  });

  it("accepts consistency_decision for consistency_decision", () => {
    expect(isValidPurpose("consistency_decision", "consistency_decision")).toBe(true);
  });

  it("rejects semantic_review for consistency_decision", () => {
    expect(isValidPurpose("consistency_decision", "semantic_review")).toBe(false);
  });

  it("rejects consistency_extraction for consistency_decision", () => {
    expect(isValidPurpose("consistency_decision", "consistency_extraction")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setRoleBinding
// ---------------------------------------------------------------------------

describe("setRoleBinding", () => {
  it("sets a binding on empty bindings", () => {
    const b = binding("general", "c1");
    const result = setRoleBinding(undefined, b);
    expect(result.general).toBeDefined();
    expect(result.general?.connectionId).toBe("c1");
  });

  it("replaces an existing binding for the same role", () => {
    const existing = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "old" },
    });
    const b = binding("general", "new");
    const result = setRoleBinding(existing, b);
    expect(result.general?.connectionId).toBe("new");
  });

  it("preserves other roles when setting a binding", () => {
    const existing = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
    });
    const b = binding("consistency_decision", "c2");
    const result = setRoleBinding(existing, b);
    expect(result.general?.connectionId).toBe("c1");
    expect(result.consistency_decision?.connectionId).toBe("c2");
  });

  it("throws when purpose is invalid for the role", () => {
    const b = binding("general", "c1", { purpose: "consistency_decision" });
    expect(() => setRoleBinding(undefined, b)).toThrow();
  });

  it("throws when reuseGeneral is true but no general binding exists", () => {
    const b = binding("consistency_decision", "c2", { reuseGeneral: true });
    expect(() => setRoleBinding(undefined, b)).toThrow();
  });

  it("accepts reuseGeneral when a general binding exists", () => {
    const existing = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
    });
    const b = binding("consistency_decision", "c2", { reuseGeneral: true });
    const result = setRoleBinding(existing, b);
    expect(result.consistency_decision?.reuseGeneral).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setReuseGeneral
// ---------------------------------------------------------------------------

describe("setReuseGeneral", () => {
  it("throws when no decision binding exists", () => {
    expect(() => setReuseGeneral(undefined, true)).toThrow();
  });

  it("throws when enabling reuse but no general binding exists", () => {
    const bindings = LlmRoleBindingsSchema.parse({
      consistency_decision: {
        role: "consistency_decision",
        provider: "anthropic",
        connectionId: "c2",
      },
    });
    expect(() => setReuseGeneral(bindings, true)).toThrow();
  });

  it("enables reuse when both bindings exist", () => {
    const bindings = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
      consistency_decision: {
        role: "consistency_decision",
        provider: "anthropic",
        connectionId: "c2",
      },
    });
    const result = setReuseGeneral(bindings, true);
    expect(result.consistency_decision?.reuseGeneral).toBe(true);
  });

  it("disables reuse without requiring a general binding check", () => {
    const bindings = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
      consistency_decision: {
        role: "consistency_decision",
        provider: "anthropic",
        connectionId: "c2",
        reuseGeneral: true,
      },
    });
    const result = setReuseGeneral(bindings, false);
    expect(result.consistency_decision?.reuseGeneral).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// removeRoleBinding
// ---------------------------------------------------------------------------

describe("removeRoleBinding", () => {
  it("removes the specified binding", () => {
    const bindings = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
      consistency_decision: {
        role: "consistency_decision",
        provider: "anthropic",
        connectionId: "c2",
      },
    });
    const result = removeRoleBinding(bindings, "general");
    expect(result.general).toBeUndefined();
    expect(result.consistency_decision).toBeDefined();
  });

  it("returns empty bindings when removing the only binding", () => {
    const bindings = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
    });
    const result = removeRoleBinding(bindings, "general");
    expect(result.general).toBeUndefined();
    expect(result.consistency_decision).toBeUndefined();
  });

  it("does nothing when the role is not bound", () => {
    const bindings = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
    });
    const result = removeRoleBinding(bindings, "consistency_decision");
    expect(result.general).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// connectionsById
// ---------------------------------------------------------------------------

describe("connectionsById", () => {
  it("returns an empty record when connections is undefined", () => {
    expect(connectionsById(undefined)).toEqual({});
  });

  it("returns the connections record as-is", () => {
    const conns = { c1: connection("c1", "openai") };
    expect(connectionsById(conns)).toBe(conns);
  });
});

// ---------------------------------------------------------------------------
// Integration: two-registry scenario
// ---------------------------------------------------------------------------

describe("two-registry integration", () => {
  it("resolves general and decision roles to different providers", () => {
    const conns = {
      "conn-openai": connection("conn-openai", "openai"),
      "conn-anthropic": connection("conn-anthropic", "anthropic"),
    };
    const bindings = LlmRoleBindingsSchema.parse({
      general: {
        role: "general",
        provider: "openai",
        connectionId: "conn-openai",
        selectedModel: "gpt-4",
      },
      consistency_decision: {
        role: "consistency_decision",
        provider: "anthropic",
        connectionId: "conn-anthropic",
        selectedModel: "claude-sonnet",
      },
    });
    const state = makeState({ llmRoleBindings: bindings, providerConnections: conns });

    const generalRegistry = createRegistryForRole("general", state.settings, bindings, conns);
    const decisionRegistry = createRegistryForRole(
      "consistency_decision",
      state.settings,
      bindings,
      conns,
    );

    expect(generalRegistry.activeName).toBe("openai");
    expect(decisionRegistry.activeName).toBe("anthropic");
  });

  it("resolves decision role to the general provider when reuseGeneral is true", () => {
    const conns = {
      "conn-openai": connection("conn-openai", "openai"),
    };
    const bindings = LlmRoleBindingsSchema.parse({
      general: {
        role: "general",
        provider: "openai",
        connectionId: "conn-openai",
        selectedModel: "gpt-4",
      },
      consistency_decision: {
        role: "consistency_decision",
        provider: "openai",
        connectionId: "conn-openai",
        selectedModel: "gpt-4-mini",
        reuseGeneral: true,
      },
    });

    const decisionRegistry = createRegistryForRole(
      "consistency_decision",
      makeState().settings,
      bindings,
      conns,
    );

    expect(decisionRegistry.activeName).toBe("openai");
  });

  it("falls back to mock when a role is unbound", () => {
    const conns = {
      "conn-openai": connection("conn-openai", "openai"),
    };
    const bindings = LlmRoleBindingsSchema.parse({
      general: {
        role: "general",
        provider: "openai",
        connectionId: "conn-openai",
      },
    });

    const decisionRegistry = createRegistryForRole(
      "consistency_decision",
      makeState().settings,
      bindings,
      conns,
    );

    expect(decisionRegistry.activeName).toBe("mock");
  });

  it("falls back to mock when the connection is disconnected", () => {
    const conns = {
      "conn-openai": connection("conn-openai", "openai", { status: "disconnected" }),
    };
    const bindings = LlmRoleBindingsSchema.parse({
      general: {
        role: "general",
        provider: "openai",
        connectionId: "conn-openai",
      },
    });

    const generalRegistry = createRegistryForRole("general", makeState().settings, bindings, conns);

    expect(generalRegistry.activeName).toBe("mock");
  });

  it("generalProviderFromState returns the general provider", () => {
    const conns = {
      "conn-openai": connection("conn-openai", "openai"),
    };
    const bindings = LlmRoleBindingsSchema.parse({
      general: {
        role: "general",
        provider: "openai",
        connectionId: "conn-openai",
      },
    });
    const state = makeState({ llmRoleBindings: bindings, providerConnections: conns });

    const provider = generalProviderFromState(state);
    expect(provider).toBeDefined();
    expect(provider?.name).toBe("openai");
  });

  it("decisionProviderFromState returns the decision provider", () => {
    const conns = {
      "conn-anthropic": connection("conn-anthropic", "anthropic"),
    };
    const bindings = LlmRoleBindingsSchema.parse({
      consistency_decision: {
        role: "consistency_decision",
        provider: "anthropic",
        connectionId: "conn-anthropic",
      },
    });
    const state = makeState({ llmRoleBindings: bindings, providerConnections: conns });

    const provider = decisionProviderFromState(state);
    expect(provider).toBeDefined();
    expect(provider?.name).toBe("anthropic");
  });

  it("decisionProviderFromState returns undefined when unbound", () => {
    const state = makeState();
    const provider = decisionProviderFromState(state);
    expect(provider).toBeUndefined();
  });

  it("isGeneralRoleConfigured returns true when general is bound and connected", () => {
    const conns = {
      "conn-openai": connection("conn-openai", "openai"),
    };
    const bindings = LlmRoleBindingsSchema.parse({
      general: {
        role: "general",
        provider: "openai",
        connectionId: "conn-openai",
      },
    });
    const state = makeState({ llmRoleBindings: bindings, providerConnections: conns });
    expect(isGeneralRoleConfigured(state)).toBe(true);
  });

  it("isDecisionRoleConfigured returns true when decision is bound and connected", () => {
    const conns = {
      "conn-anthropic": connection("conn-anthropic", "anthropic"),
    };
    const bindings = LlmRoleBindingsSchema.parse({
      consistency_decision: {
        role: "consistency_decision",
        provider: "anthropic",
        connectionId: "conn-anthropic",
      },
    });
    const state = makeState({ llmRoleBindings: bindings, providerConnections: conns });
    expect(isDecisionRoleConfigured(state)).toBe(true);
  });

  it("isDecisionRoleConfigured returns false when unbound", () => {
    const state = makeState();
    expect(isDecisionRoleConfigured(state)).toBe(false);
  });
});
