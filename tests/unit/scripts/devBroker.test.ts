import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  createLocalLlmBroker,
  isLocalBrokerUrl,
  validateBrokerOrigin,
  validateBrokerPayload,
  validateSessionNonce,
} from "../../../scripts/dev-broker.mjs";

function response() {
  const chunks: string[] = [];
  return {
    statusCode: 0,
    headers: new Map<string, string>(),
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
    },
    end(value?: string) {
      if (value !== undefined) chunks.push(value);
    },
    body: () => chunks.join(""),
  };
}

function request(options: { method?: string; headers?: Record<string, string>; body?: string }) {
  const stream = Readable.from([options.body ?? ""]) as Readable & {
    headers: Record<string, string>;
    method: string;
    url: string;
  };
  stream.headers = options.headers ?? {};
  stream.method = options.method ?? "POST";
  stream.url = "/__toneforge/llm/v1/chat/completions";
  return stream;
}

describe("development LLM broker boundaries", () => {
  it("accepts only local broker URLs", () => {
    expect(isLocalBrokerUrl("https://localhost:3000/__toneforge/llm/v1")).toBe(true);
    expect(isLocalBrokerUrl("http://127.0.0.1:3000/__toneforge/llm/v1")).toBe(true);
    expect(isLocalBrokerUrl("https://example.com/__toneforge/llm/v1")).toBe(false);
    expect(isLocalBrokerUrl("file:///tmp/broker")).toBe(false);
  });

  it("rejects disallowed origins and accepts a matching local origin", () => {
    expect(
      validateBrokerOrigin({ origin: "https://evil.example", host: "localhost:3000" }).allowed,
    ).toBe(false);
    expect(
      validateBrokerOrigin({ origin: "https://localhost:3000", host: "localhost:3000" }).allowed,
    ).toBe(true);
  });

  it("requires a matching session nonce when used as the broker authorization", () => {
    expect(validateSessionNonce({ "x-toneforge-session-nonce": "wrong" }, "right")).toBe(false);
    expect(validateSessionNonce({ "x-toneforge-session-nonce": "right" }, "right")).toBe(true);
  });

  it("rejects invalid content types, payload schema, and oversized bodies", async () => {
    const fetchImpl = vi.fn();
    const broker = createLocalLlmBroker({
      fetchImpl,
      expectedNonce: "nonce",
      getApiKey: () => "key",
    });
    const invalidType = response();
    await broker(
      request({
        headers: {
          origin: "https://localhost:3000",
          host: "localhost:3000",
          "content-type": "text/plain",
        },
      }),
      invalidType,
      vi.fn(),
    );
    expect(invalidType.statusCode).toBe(415);

    const invalidSchema = response();
    await broker(
      request({
        headers: {
          origin: "https://localhost:3000",
          host: "localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "", messages: [] }),
      }),
      invalidSchema,
      vi.fn(),
    );
    expect(invalidSchema.statusCode).toBe(400);
    expect(invalidSchema.body()).toContain("model");

    const oversized = response();
    await broker(
      request({
        headers: {
          origin: "https://localhost:3000",
          host: "localhost:3000",
          "content-type": "application/json",
        },
        body: "x".repeat(1_000_001),
      }),
      oversized,
      vi.fn(),
    );
    expect(oversized.statusCode).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates chat completion payload shape without forwarding it", () => {
    expect(
      validateBrokerPayload({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
    ).toEqual({ valid: true });
    expect(
      validateBrokerPayload({ model: "gpt-4o-mini", messages: [{ role: "system", content: 3 }] })
        .valid,
    ).toBe(false);
  });
});
