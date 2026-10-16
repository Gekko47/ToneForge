/**
 * The failure copy table and the diagnostic report.
 *
 * Two properties matter here and neither is about wording for its own sake: every
 * code must have a sentence and a control (a code without copy reaches the user as
 * nothing at all), and the report must not be able to carry document text — which
 * is only true if it is built from fields, so that is what the test asserts.
 */

import { describe, expect, it } from "vitest";

import {
  SEMANTIC_FAILURE_CODES,
  SemanticReviewError,
} from "../../../../src/analysis/semantic/failures";
import {
  STAGE_LABEL,
  failureCopy,
  failureCopyFor,
  stageLabel,
} from "../../../../src/taskpane/semantic/failureCopy";
import { buildDiagnosticReport } from "../../../../src/taskpane/semantic/diagnosticReport";

describe("the failure copy table", () => {
  it("gives every code a sentence and a control", () => {
    SEMANTIC_FAILURE_CODES.forEach((code) => {
      const copy = failureCopy(code);
      expect(copy.message.length).toBeGreaterThan(0);
      expect(copy.recovery.label.length).toBeGreaterThan(0);
    });
  });

  it("names the next action rather than the internals", () => {
    SEMANTIC_FAILURE_CODES.forEach((code) => {
      const { message } = failureCopy(code);
      // No status codes, no stack words, no snake_case identifiers leaking through.
      expect(message).not.toMatch(/\b\d{3}\b/);
      expect(message).not.toMatch(/undefined|null|Error:/);
    });
  });

  it("labels every stage with a sentence a person would say", () => {
    Object.values(STAGE_LABEL).forEach((label) => {
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/_/);
    });
  });
});

describe("failureCopyFor", () => {
  it("reads the code and stage from a typed failure", () => {
    const view = failureCopyFor(new SemanticReviewError("internal detail", "E_PROVIDER_AUTH"));
    expect(view.code).toBe("E_PROVIDER_AUTH");
    expect(view.stage).toBe("provider_call");
    expect(view.message).toMatch(/credentials/i);
  });

  it("does not put an unknown error's own message in front of the user", () => {
    const leaked = "gateway HTTP 500: at Object.<anonymous> sk-secret-value";
    const view = failureCopyFor(new Error(leaked));
    expect(view.message).not.toContain("sk-secret-value");
    expect(view.message).not.toContain("Object.<anonymous>");
    expect(view.code).toBe("E_PROVIDER_TRANSIENT");
  });
});

describe("stageLabel", () => {
  it("has no sentence for a state that is not a stage", () => {
    expect(stageLabel("idle")).toBeNull();
    expect(stageLabel("done")).toBeNull();
    expect(stageLabel("failed")).toBeNull();
  });

  it("names what is happening for a stage that is running", () => {
    expect(stageLabel("provider_call")).toMatch(/provider/i);
  });
});

describe("buildDiagnosticReport", () => {
  it("carries identifiers, codes and counts and no text", () => {
    const report = buildDiagnosticReport({
      runId: "run-1",
      failure: { code: "E_RESPONSE_SCHEMA_INVALID", stage: "response_parse" },
      provider: { provider: "openai", model: "gpt-4o-mini", latencyMs: 1200, attempt: 2 },
      providerAttempts: [
        { durationMs: 1180, waitMs: 0, outcome: "ok", headersMs: 1100, bodyMs: 80, status: 200 },
      ],
      stageTimings: { provider_call: 1180, response_parse: 2 },
      selectionChars: 480,
      at: "2026-10-15T00:00:00.000Z",
    });

    expect(report).toEqual({
      schema: "toneforge.semantic-review-diagnostic/v1",
      runId: "run-1",
      failureCode: "E_RESPONSE_SCHEMA_INVALID",
      stage: "response_parse",
      provider: { provider: "openai", model: "gpt-4o-mini", attempt: 2, latencyMs: 1200 },
      stageTimingsMs: { provider_call: 1180, response_parse: 2 },
      providerAttempts: [
        { durationMs: 1180, waitMs: 0, outcome: "ok", headersMs: 1100, bodyMs: 80, status: 200 },
      ],
      selectionChars: 480,
      timestamp: "2026-10-15T00:00:00.000Z",
    });
  });

  it("states that there was no provider rather than inventing one", () => {
    const report = buildDiagnosticReport({
      runId: "run-2",
      failure: { code: "E_PROMPT_CONSENT_GATE", stage: "prompt_build" },
      provider: null,
      providerAttempts: null,
      stageTimings: null,
      selectionChars: null,
      at: "2026-10-15T00:00:00.000Z",
    });
    expect(report.provider).toBeNull();
    expect(report.stageTimingsMs).toEqual({});
    expect(report.providerAttempts).toBeNull();
    // Serialised, the report is the same set of keys every time — which is what
    // makes it safe to paste somewhere a support reader can see.
    expect(Object.keys(report)).not.toContain("text");
  });

  it("names the provider of a failed run, and states the rest as unknown", () => {
    // A failed run never produced a model, a latency or an attempt count. Writing
    // zeros there would read as measurements, so the report states them as null —
    // while still naming the provider, which is the first question a run that never
    // answered raises.
    const report = buildDiagnosticReport({
      runId: "run-3",
      failure: { code: "E_PROVIDER_TRANSIENT", stage: "provider_call" },
      provider: { provider: "openrouter" },
      providerAttempts: [{ durationMs: 30000, waitMs: 0, outcome: "error", headersMs: 30000 }],
      stageTimings: { prompt_build: 12, provider_call: 340 },
      selectionChars: 3707,
      at: "2026-10-16T00:00:00.000Z",
    });
    expect(report.provider).toEqual({
      provider: "openrouter",
      model: null,
      attempt: null,
      latencyMs: null,
    });
    expect(report.stageTimingsMs).toEqual({ prompt_build: 12, provider_call: 340 });
    // An attempt that never received a body states bodyMs as null, not zero — the
    // shape of a request that hung until its own deadline.
    expect(report.providerAttempts).toEqual([
      {
        durationMs: 30000,
        waitMs: 0,
        outcome: "error",
        headersMs: 30000,
        bodyMs: null,
        status: null,
      },
    ]);
  });
});
