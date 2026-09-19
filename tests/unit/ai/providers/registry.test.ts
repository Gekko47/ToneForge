import { describe, it, expect } from "vitest";
import { LlmRegistry, MockAdapter, OpenAiAdapter } from "../../../../src/ai/providers/index";

describe("LlmRegistry", () => {
  it("defaults to mock adapter when no API key is configured", () => {
    const registry = new LlmRegistry();
    expect(registry.activeName).toBe("mock");
  });

  it("defaults to openai adapter when API key is configured", () => {
    const registry = new LlmRegistry({ openai: { apiKey: "sk-test" } });
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

  it("exposes typed adapters", () => {
    const registry = new LlmRegistry({ provider: "mock" });
    expect(registry.activeProvider).toBeInstanceOf(MockAdapter);
    const openai = new OpenAiAdapter({ apiKey: "sk-test" });
    expect(openai.configured).toBe(true);
  });
});
