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

  it("failOn takes precedence over responses when needles overlap", async () => {
    const adapter = new MockAdapter({
      responses: { explode: "should not win" },
      failOn: ["explode"],
    });
    await expect(adapter.complete({ prompt: "explode now" })).rejects.toBeInstanceOf(LlmError);
  });

  it("throws non-retryable LlmError when caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = new MockAdapter();
    await expect(
      adapter.complete({ prompt: "anything", signal: controller.signal }),
    ).rejects.toMatchObject({
      retryable: false,
      message: "Mock request aborted by caller",
    });
  });
});
