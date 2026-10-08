import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE_PURPOSE,
  DecisionFallbackPolicySchema,
  LlmRoleBindingSchema,
  LlmRoleBindingsSchema,
  LlmRoleSchema,
  LlmPurposeSchema,
  assertRoleSchemasAreSecretFree,
  createEmptyRoleBindings,
  isBindingUsable,
} from "../../../../src/core/domain/LlmRole";

describe("LlmRoleSchema", () => {
  it("accepts the two valid roles", () => {
    expect(LlmRoleSchema.parse("general")).toBe("general");
    expect(LlmRoleSchema.parse("consistency_decision")).toBe("consistency_decision");
  });

  it("rejects an unknown role", () => {
    expect(() => LlmRoleSchema.parse("unknown")).toThrow();
  });
});

describe("LlmPurposeSchema", () => {
  it("accepts the three valid purposes", () => {
    expect(LlmPurposeSchema.parse("semantic_review")).toBe("semantic_review");
    expect(LlmPurposeSchema.parse("consistency_extraction")).toBe("consistency_extraction");
    expect(LlmPurposeSchema.parse("consistency_decision")).toBe("consistency_decision");
  });

  it("rejects an unknown purpose", () => {
    expect(() => LlmPurposeSchema.parse("other")).toThrow();
  });
});

describe("DEFAULT_ROLE_PURPOSE", () => {
  it("maps general to consistency_extraction", () => {
    expect(DEFAULT_ROLE_PURPOSE.general).toBe("consistency_extraction");
  });

  it("maps consistency_decision to consistency_decision", () => {
    expect(DEFAULT_ROLE_PURPOSE.consistency_decision).toBe("consistency_decision");
  });
});

describe("LlmRoleBindingSchema", () => {
  it("parses a minimal binding with defaults", () => {
    const binding = LlmRoleBindingSchema.parse({
      role: "general",
      provider: "openai",
      connectionId: "conn-1",
    });
    expect(binding.role).toBe("general");
    expect(binding.provider).toBe("openai");
    expect(binding.connectionId).toBe("conn-1");
    expect(binding.reuseGeneral).toBe(false);
    expect(binding.selectedModel).toBeUndefined();
    expect(binding.purpose).toBeUndefined();
  });

  it("parses a fully specified binding", () => {
    const binding = LlmRoleBindingSchema.parse({
      role: "consistency_decision",
      provider: "anthropic",
      connectionId: "conn-2",
      selectedModel: "claude-sonnet",
      purpose: "consistency_decision",
      reuseGeneral: true,
    });
    expect(binding.selectedModel).toBe("claude-sonnet");
    expect(binding.purpose).toBe("consistency_decision");
    expect(binding.reuseGeneral).toBe(true);
  });

  it("rejects an empty connectionId", () => {
    expect(() =>
      LlmRoleBindingSchema.parse({ role: "general", provider: "openai", connectionId: "" }),
    ).toThrow();
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      LlmRoleBindingSchema.parse({ role: "general", provider: "unknown", connectionId: "c" }),
    ).toThrow();
  });

  it("rejects an unknown role", () => {
    expect(() =>
      LlmRoleBindingSchema.parse({ role: "unknown", provider: "openai", connectionId: "c" }),
    ).toThrow();
  });

  it("trims whitespace from connectionId", () => {
    const binding = LlmRoleBindingSchema.parse({
      role: "general",
      provider: "openai",
      connectionId: "  conn-1  ",
    });
    expect(binding.connectionId).toBe("conn-1");
  });
});

describe("LlmRoleBindingsSchema", () => {
  it("parses empty bindings", () => {
    const bindings = LlmRoleBindingsSchema.parse({});
    expect(bindings.general).toBeUndefined();
    expect(bindings.consistency_decision).toBeUndefined();
  });

  it("parses bindings with only general", () => {
    const bindings = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
    });
    expect(bindings.general).toBeDefined();
    expect(bindings.consistency_decision).toBeUndefined();
  });

  it("parses bindings with both roles", () => {
    const bindings = LlmRoleBindingsSchema.parse({
      general: { role: "general", provider: "openai", connectionId: "c1" },
      consistency_decision: {
        role: "consistency_decision",
        provider: "anthropic",
        connectionId: "c2",
      },
    });
    expect(bindings.general).toBeDefined();
    expect(bindings.consistency_decision).toBeDefined();
  });
});

describe("DecisionFallbackPolicySchema", () => {
  it("accepts unresolved", () => {
    expect(DecisionFallbackPolicySchema.parse("unresolved")).toBe("unresolved");
  });

  it("accepts general_model", () => {
    expect(DecisionFallbackPolicySchema.parse("general_model")).toBe("general_model");
  });

  it("rejects an unknown policy", () => {
    expect(() => DecisionFallbackPolicySchema.parse("other")).toThrow();
  });
});

describe("createEmptyRoleBindings", () => {
  it("returns bindings with no roles set", () => {
    const bindings = createEmptyRoleBindings();
    expect(bindings.general).toBeUndefined();
    expect(bindings.consistency_decision).toBeUndefined();
  });
});

describe("isBindingUsable", () => {
  const connections: Record<string, { status: string }> = {
    "conn-1": { status: "connected" },
    "conn-2": { status: "disconnected" },
  };

  it("returns false when binding is undefined", () => {
    expect(isBindingUsable(undefined, connections)).toBe(false);
  });

  it("returns false when the connection does not exist", () => {
    const binding = LlmRoleBindingSchema.parse({
      role: "general",
      provider: "openai",
      connectionId: "missing",
    });
    expect(isBindingUsable(binding, connections)).toBe(false);
  });

  it("returns false when the connection is disconnected", () => {
    const binding = LlmRoleBindingSchema.parse({
      role: "general",
      provider: "openai",
      connectionId: "conn-2",
    });
    expect(isBindingUsable(binding, connections)).toBe(false);
  });

  it("returns true when the connection exists and is connected", () => {
    const binding = LlmRoleBindingSchema.parse({
      role: "general",
      provider: "openai",
      connectionId: "conn-1",
    });
    expect(isBindingUsable(binding, connections)).toBe(true);
  });
});

describe("assertRoleSchemasAreSecretFree", () => {
  it("passes because the only string fields are known non-secret identifiers", () => {
    // `connectionId` and `selectedModel` are identifiers, not credentials.
    // Any OTHER string field would fail the reflection test.
    expect(() => assertRoleSchemasAreSecretFree()).not.toThrow();
  });
});
