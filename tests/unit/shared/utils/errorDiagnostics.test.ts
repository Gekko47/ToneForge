import { describe, expect, it } from "vitest";
import { redactDiagnosticContext } from "../../../../src/shared/utils/redaction";
import { describeError } from "../../../../src/shared/utils/logger";

describe("redaction of diagnostics", () => {
  it("still redacts a bare error field, which may quote document text", () => {
    expect(redactDiagnosticContext({ error: "Failed at: the quick brown fox" })).toEqual({
      error: "[REDACTED_CONTENT]",
    });
  });

  it("still redacts document and prompt content", () => {
    const result = redactDiagnosticContext({
      documentText: "confidential body",
      prompt: "be terse",
    });
    expect(result.documentText).toBe("[REDACTED_CONTENT]");
    expect(result.prompt).toBe("[REDACTED_CONTENT]");
  });

  it("keeps the error name, code, and message visible so a failure is diagnosable", () => {
    const result = redactDiagnosticContext(
      describeError(Object.assign(new Error("GeneralException"), { code: 5001 })),
    );
    expect(result.errorName).toBe("Error");
    expect(result.errorMessage).toBe("GeneralException");
    expect(result.errorCode).toBe(5001);
  });

  it("redacts credentials even in an allowlisted diagnostic field", () => {
    const result = redactDiagnosticContext({ errorMessage: "rejected key sk-abcdef123456" });
    expect(result.errorMessage).toBe("rejected key [REDACTED_API_KEY]");
  });

  it("caps an allowlisted message rather than logging a paragraph in full", () => {
    const result = redactDiagnosticContext({ errorMessage: "x".repeat(500) });
    expect(String(result.errorMessage).length).toBeLessThanOrEqual(201);
  });
});

describe("describeError", () => {
  it("keeps a numeric Office error code", () => {
    expect(describeError({ name: "Error", code: 5001, message: "GeneralException" })).toEqual({
      errorName: "Error",
      errorMessage: "GeneralException",
      errorCode: 5001,
    });
  });

  it("stringifies a code so a string code is not dropped", () => {
    expect(describeError({ code: "InvalidArgument", message: "bad range" }).errorCode).toBe(
      "InvalidArgument",
    );
  });

  it("handles a plain string and a non-object", () => {
    expect(describeError("boom")).toEqual({ errorMessage: "boom" });
    expect(describeError(42)).toEqual({ errorMessage: "42" });
  });

  it("omits the code entirely when the host supplies none", () => {
    expect(describeError(new Error("nope"))).not.toHaveProperty("errorCode");
  });
});
