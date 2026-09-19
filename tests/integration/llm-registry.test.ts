import { describe, it, expect } from "vitest";
import { LlmRegistry } from "../../src/ai/providers/index";

describe("LlmRegistry integration", () => {
  it("completes via mock with scripted profile JSON", async () => {
    const registry = new LlmRegistry({
      provider: "mock",
      mock: {
        responses: {
          "analyze the following": '{"tone":"formal","voice":"first-person"}',
        },
      },
    });
    const res = await registry.complete({
      prompt: "analyze the following writing sample",
    });
    expect(res.text).toContain("formal");
    expect(res.model).toBe("mock");
  });
});
