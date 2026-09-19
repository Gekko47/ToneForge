import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAiAdapter, LlmError } from "../../../../src/ai/providers/index";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 429 ? "Too Many Requests" : "Server Error",
    json: async () => body,
  });
}

describe("OpenAiAdapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("is not configured without an API key", () => {
    const adapter = new OpenAiAdapter({});
    expect(adapter.configured).toBe(false);
  });

  it("throws non-retryable error when unconfigured", async () => {
    const adapter = new OpenAiAdapter({});
    await expect(adapter.complete({ prompt: "hi" })).rejects.toThrow(LlmError);
    await expect(adapter.complete({ prompt: "hi" })).rejects.toMatchObject({
      retryable: false,
    });
  });

  it("parses a successful response", async () => {
    globalThis.fetch = mockFetch(200, {
      choices: [{ message: { content: "Hello there" } }],
      model: "gpt-4o-mini",
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }) as unknown as typeof fetch;

    const adapter = new OpenAiAdapter({ apiKey: "sk-test", timeoutMs: 1000 });
    const res = await adapter.complete({ prompt: "hi" });
    expect(res.text).toBe("Hello there");
    expect(res.model).toBe("gpt-4o-mini");
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });

  it("retries on 429 then succeeds", async () => {
    const fetchMock = mockFetch(200, {
      choices: [{ message: { content: "ok" } }],
      model: "gpt-4o-mini",
    });
    // First two calls fail with 429, third succeeds.
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: async () => ({}),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new OpenAiAdapter({
      apiKey: "sk-test",
      timeoutMs: 1000,
      maxRetries: 3,
    });
    const res = await adapter.complete({ prompt: "hi" });
    expect(res.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry on 400", async () => {
    globalThis.fetch = mockFetch(400, {
      error: { message: "bad request" },
    }) as unknown as typeof fetch;
    const adapter = new OpenAiAdapter({ apiKey: "sk-test", maxRetries: 3 });
    await expect(adapter.complete({ prompt: "hi" })).rejects.toThrow(LlmError);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 500 and eventually fails", async () => {
    globalThis.fetch = mockFetch(500, { error: { message: "boom" } }) as unknown as typeof fetch;
    const adapter = new OpenAiAdapter({ apiKey: "sk-test", maxRetries: 2 });
    await expect(adapter.complete({ prompt: "hi" })).rejects.toThrow(LlmError);
    // maxRetries=2 means 3 attempts total.
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("marks timeout as retryable", async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          const err = new DOMException("The operation was aborted", "AbortError");
          reject(err);
        }),
    ) as unknown as typeof fetch;

    const adapter = new OpenAiAdapter({
      apiKey: "sk-test",
      timeoutMs: 1000,
      maxRetries: 0,
    });
    await expect(adapter.complete({ prompt: "hi" })).rejects.toMatchObject({
      retryable: true,
      message: "OpenAI request timed out",
    });
  });

  it("marks caller abort as non-retryable", async () => {
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const adapter = new OpenAiAdapter({ apiKey: "sk-test", maxRetries: 3 });
    await expect(
      adapter.complete({ prompt: "hi", signal: controller.signal }),
    ).rejects.toMatchObject({
      retryable: false,
      message: "OpenAI request aborted by caller",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("redacts emails and API keys from logged errors", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        new Error("Request failed for user alice@example.com with key sk-ABC123XYZ"),
      ) as unknown as typeof fetch;

    const adapter = new OpenAiAdapter({ apiKey: "sk-test", maxRetries: 0 });
    await expect(adapter.complete({ prompt: "hi" })).rejects.toThrow();
  });

  it("redact() strips sensitive patterns", () => {
    const adapter = new OpenAiAdapter({ apiKey: "sk-test" });
    const out = adapter.redact("Contact me at alice@example.com or use sk-ABC123XYZ");
    expect(out).toContain("[REDACTED_EMAIL]");
    expect(out).toContain("[REDACTED_API_KEY]");
    expect(out).not.toContain("alice@example.com");
    expect(out).not.toContain("sk-ABC123XYZ");
  });
});
