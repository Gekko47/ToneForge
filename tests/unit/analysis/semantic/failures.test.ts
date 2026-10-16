/**
 * The failure taxonomy.
 *
 * The point of these tests is that classification is decided by fields and never
 * by message text: a redacted message is what reaches a log, and reading a
 * decision out of one is how a log line becomes a user-facing claim.
 */

import { describe, expect, it } from "vitest";

import {
  SEMANTIC_FAILURE_CODES,
  SEMANTIC_STAGES,
  SemanticReviewError,
  classifyProviderFailure,
  isSemanticReviewError,
  stageForCode,
} from "../../../../src/analysis/semantic/failures";
import { LlmError } from "../../../../src/ai/providers/LlmProvider";

function providerError(status: number | undefined, retryable: boolean): LlmError {
  return new LlmError(`test gateway HTTP ${status ?? "none"}`, "test", retryable, status);
}

describe("classifyProviderFailure", () => {
  it("reads a refusal of the connection from the status", () => {
    expect(classifyProviderFailure(providerError(401, false), false)).toBe("E_PROVIDER_AUTH");
    expect(classifyProviderFailure(providerError(403, false), false)).toBe("E_PROVIDER_AUTH");
  });

  it("separates a busy provider from a broken one", () => {
    expect(classifyProviderFailure(providerError(429, true), false)).toBe("E_PROVIDER_RATE_LIMIT");
    expect(classifyProviderFailure(providerError(503, true), false)).toBe("E_PROVIDER_SERVER");
  });

  it("reads a declined request as the provider refusing this text", () => {
    expect(classifyProviderFailure(providerError(400, false), false)).toBe(
      "E_PROVIDER_CONTENT_FILTER",
    );
    expect(classifyProviderFailure(providerError(422, false), false)).toBe(
      "E_PROVIDER_CONTENT_FILTER",
    );
  });

  it("reads a failure with no status as never having reached a provider", () => {
    // A timeout or a network fault: no status, worth retrying.
    expect(classifyProviderFailure(providerError(undefined, true), false)).toBe(
      "E_PROVIDER_UNREACHABLE",
    );
    // No status and not retryable: a connection this add-in was never given.
    expect(classifyProviderFailure(providerError(undefined, false), false)).toBe(
      "E_PROVIDER_UNCONFIGURED",
    );
  });

  it("treats the caller's own abort as a cancellation, status or not", () => {
    expect(classifyProviderFailure(providerError(429, true), true)).toBe("E_PROVIDER_CANCELLED");
    expect(classifyProviderFailure(new DOMException("aborted", "AbortError"), false)).toBe(
      "E_PROVIDER_CANCELLED",
    );
  });

  it("falls back to a transient failure for anything it does not recognise", () => {
    expect(classifyProviderFailure(new Error("boom"), false)).toBe("E_PROVIDER_TRANSIENT");
    expect(classifyProviderFailure("a string was thrown", false)).toBe("E_PROVIDER_TRANSIENT");
  });
});

describe("SemanticReviewError", () => {
  it("derives its stage from its code rather than being told twice", () => {
    const error = new SemanticReviewError("message", "E_APPLY_FAILED");
    expect(error.stage).toBe("apply");
    expect(error.name).toBe("SemanticReviewError");
  });

  it("is recognisable from an unknown catch", () => {
    expect(isSemanticReviewError(new SemanticReviewError("m", "E_RESPONSE_EMPTY"))).toBe(true);
    expect(isSemanticReviewError(new Error("m"))).toBe(false);
  });
});

describe("the taxonomy itself", () => {
  it("assigns every code to a stage it declares", () => {
    SEMANTIC_FAILURE_CODES.forEach((code) => {
      expect(SEMANTIC_STAGES).toContain(stageForCode(code));
    });
  });

  it("declares no code twice", () => {
    expect(new Set(SEMANTIC_FAILURE_CODES).size).toBe(SEMANTIC_FAILURE_CODES.length);
  });
});
