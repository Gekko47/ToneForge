import { describe, it, expect } from "vitest";
import { LlmRegistry, MockAdapter, OpenAiAdapter } from "../../../../src/ai/providers/index";

describe("LlmRegistry", () => {
  it("defaults to mock adapter when no API key is configured", () => {
    const registry = new LlmRegistry();
    expect(registry.activeName).toBe("mock");
  });

  it("defaults to openai adapter for a configured broker", () => {
    const registry = new LlmRegistry({
      openai: { credentialMode: "broker", baseUrl: "/__toneforge/llm/v1" },
    });
    expect(registry.activeName).toBe("openai");
  });

  it("can switch to mock", () => {
    const registry = new LlmRegistry({ provider: "mock" });
    expect(registry.activeName).toBe("mock");
    registry.switch("openai");
    expect(registry.activeName).toBe("openai");
  });

  it("falls back to mock on provider failure", async () => {
    const registry = new LlmRegistry({ provider: "openai" });
    const result = await registry.completeWithFallback({ prompt: "test" }, "mock");
    expect(result.text).toContain("Mocked response");
  });

  it("exposes typed adapters for mock, broker, and explicit user configuration", () => {
    const mockRegistry = new LlmRegistry({ provider: "mock" });
    expect(mockRegistry.activeProvider).toBeInstanceOf(MockAdapter);
    const broker = new OpenAiAdapter({
      credentialMode: "broker",
      baseUrl: "/__toneforge/llm/v1",
    });
    expect(broker.configured).toBe(true);
    const userSupplied = new OpenAiAdapter({
      credentialMode: "apiKey",
      apiKey: "sk-test",
    });
    expect(userSupplied.configured).toBe(true);
  });
});
