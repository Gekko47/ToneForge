import { describe, it, expect } from "vitest";
import { MockAdapter, LlmError } from "../../../../src/ai/providers/index";

describe("MockAdapter", () => {
  it("returns default response", async () => {
    const adapter = new MockAdapter();
    const res = await adapter.complete({ prompt: "anything" });
    expect(res.text).toBe("Mocked response.");
    expect(res.model).toBe("mock");
  });

  it("matches scripted responses by substring", async () => {
    const adapter = new MockAdapter({
      responses: { "profile me": '{"tone":"formal"}' },
      defaultResponse: "fallback",
    });
    const res = await adapter.complete({ prompt: "please profile me this text" });
    expect(res.text).toBe('{"tone":"formal"}');
  });

  it("throws LlmError when failOn matches", async () => {
    const adapter = new MockAdapter({ failOn: ["explode"] });
    await expect(adapter.complete({ prompt: "explode now" })).rejects.toBeInstanceOf(LlmError);
  });
});
