import { describe, expect, it, vi } from "vitest";
import {
  redactDiagnosticContext,
  redactSensitiveText,
} from "../../../../src/shared/utils/redaction";
import { logger } from "../../../../src/shared/utils/logger";

describe("privacy redaction", () => {
  it("redacts secret-shaped values in untrusted text", () => {
    const redacted = redactSensitiveText(
      "alice@example.com sk-ABC123XYZ Bearer abcdefghijklmnop and 0123456789abcdef0123456789abcdef",
    );

    expect(redacted).not.toContain("alice@example.com");
    expect(redacted).not.toContain("sk-ABC123XYZ");
    expect(redacted).not.toContain("abcdefghijklmnop");
    expect(redacted).not.toContain("0123456789abcdef0123456789abcdef");
  });

  it("removes nested credentials, prompts, and document content", () => {
    const redacted = redactDiagnosticContext({
      apiKey: "plain-value",
      nested: {
        prompt: "private prompt",
        documentText: "private document",
        safe: "operation completed",
      },
      messages: [{ content: "private content", status: "ok" }],
    });

    expect(redacted).toEqual({
      apiKey: "[REDACTED]",
      nested: {
        prompt: "[REDACTED_CONTENT]",
        documentText: "[REDACTED_CONTENT]",
        safe: "operation completed",
      },
      messages: [{ content: "[REDACTED_CONTENT]", status: "ok" }],
    });
  });

  it("hardens warning logs without including untrusted content", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("operation failed", {
      token: "secret-token-value",
      prompt: "private prompt",
      error: "email alice@example.com key sk-ABC123XYZ",
    });

    const output = String(warn.mock.calls[0]?.[0]);
    expect(output).toContain("operation failed");
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("secret-token-value");
    expect(output).not.toContain("private prompt");
    expect(output).not.toContain("alice@example.com");
    expect(output).not.toContain("sk-ABC123XYZ");
  });
});
