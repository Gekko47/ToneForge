import { describe, expect, it } from "vitest";
import {
  buildVerificationSummary,
  EXTERNAL_EVIDENCE_STAGE,
  STAGE_OWNERSHIP,
  VERIFICATION_GRAPH,
  VERIFICATION_GRAPH_NAME,
  VERIFICATION_SUMMARY_PATH,
} from "../../../scripts/verification-graph.mjs";

/**
 * The summary's job is to make a green run honest. The properties that matter:
 *
 * - a failing stage is recorded even when later stages pass;
 * - a stage that never ran is `pending`, never silently absent;
 * - the human Word-host gate is always reported open, because no automated run
 *   can satisfy it and a summary that implied otherwise would be dangerous.
 */

const START = "2026-01-01T00:00:00.000Z";
const END = "2026-01-01T00:05:00.000Z";

function allPassed(): Record<string, boolean> {
  return Object.fromEntries(VERIFICATION_GRAPH.map((stage) => [stage.name, true]));
}

describe("verification graph", () => {
  it("keeps its canonical name", () => {
    expect(VERIFICATION_GRAPH_NAME).toBe("toneforge-repository-v1");
  });

  it("runs the thirteen automated stages in order", () => {
    expect(VERIFICATION_GRAPH).toHaveLength(13);
    expect(VERIFICATION_GRAPH.map((stage) => stage.name)).toEqual([
      "typecheck",
      "lint",
      "format",
      "secret-scan",
      "docs",
      "skills",
      "test",
      "coverage",
      "build-artifacts",
      "built-secret-scan",
      "manifest",
      "package",
      "package-check",
    ]);
  });

  it("gives every executable stage a command", () => {
    VERIFICATION_GRAPH.forEach((stage) => {
      expect(stage.command.length).toBeGreaterThan(0);
    });
  });

  it("writes the summary under build/ so it is a build artifact, not source", () => {
    expect(VERIFICATION_SUMMARY_PATH.replace(/\\/g, "/")).toBe("build/verification/summary.json");
  });

  it("exposes the external gate without making it runnable", () => {
    expect(EXTERNAL_EVIDENCE_STAGE?.name).toBe("word-host-evidence");
    expect(EXTERNAL_EVIDENCE_STAGE?.command).toBeNull();
    expect(VERIFICATION_GRAPH.map((stage) => stage.name)).not.toContain("word-host-evidence");
  });
});

describe("buildVerificationSummary", () => {
  it("reports ok when every automated stage passed", () => {
    const summary = buildVerificationSummary({
      results: allPassed(),
      startedAt: START,
      finishedAt: END,
    });
    expect(summary.ok).toBe(true);
    expect(summary.failureOwners).toEqual([]);
  });

  it("still reports the human host gate as open on an all-green run", () => {
    // This is the property that makes the summary worth having: automation
    // cannot certify Word-host behavior, so a fully green run is not a release.
    const summary = buildVerificationSummary({
      results: allPassed(),
      startedAt: START,
      finishedAt: END,
    });
    expect(summary.openExternalGates).toEqual(["word-host-evidence"]);
  });

  it("marks a failed stage failed and the run not ok", () => {
    const summary = buildVerificationSummary({
      results: { ...allPassed(), typecheck: false },
      startedAt: START,
      finishedAt: END,
    });
    expect(summary.ok).toBe(false);
    expect(summary.stages.find((stage) => stage.name === "typecheck")?.status).toBe("failed");
  });

  it("classifies a typecheck failure as repository code", () => {
    const summary = buildVerificationSummary({
      results: { ...allPassed(), typecheck: false },
      startedAt: START,
      finishedAt: END,
    });
    expect(summary.failureOwners).toEqual([STAGE_OWNERSHIP["repository-code"]]);
  });

  it("classifies a package failure as build-package", () => {
    const summary = buildVerificationSummary({
      results: { ...allPassed(), package: false },
      startedAt: START,
      finishedAt: END,
    });
    expect(summary.failureOwners).toEqual([STAGE_OWNERSHIP["build-package"]]);
  });

  it("reports every distinct failing owner, not just the first", () => {
    const summary = buildVerificationSummary({
      results: { ...allPassed(), lint: false, "package-check": false },
      startedAt: START,
      finishedAt: END,
    });
    expect(summary.failureOwners).toEqual(
      expect.arrayContaining([
        STAGE_OWNERSHIP["repository-code"],
        STAGE_OWNERSHIP["build-package"],
      ]),
    );
  });

  it("records a cascade: a later stage that failed because an earlier one did", () => {
    // `build:check` reads dist/, so a typecheck failure cascades into it. Both
    // are real failures and both belong in the report.
    const summary = buildVerificationSummary({
      results: { typecheck: false, "build-artifacts": false },
      startedAt: START,
      finishedAt: END,
    });
    expect(summary.stages.find((stage) => stage.name === "build-artifacts")?.status).toBe("failed");
    expect(summary.ok).toBe(false);
  });

  it("marks a stage with no result as pending rather than omitting it", () => {
    const summary = buildVerificationSummary({ results: {}, startedAt: START, finishedAt: END });
    expect(summary.ok).toBe(true);
    VERIFICATION_GRAPH.forEach((stage) => {
      expect(summary.stages.find((entry) => entry.name === stage.name)?.status).toBe("pending");
    });
  });

  it("never marks the external gate as passed", () => {
    // A caller cannot smuggle a pass in for the human gate.
    const summary = buildVerificationSummary({
      results: { ...allPassed(), "word-host-evidence": true },
      startedAt: START,
      finishedAt: END,
    });
    expect(summary.stages.find((stage) => stage.name === "word-host-evidence")?.status).toBe(
      "pending",
    );
  });

  it("explains why the external gate is not automatable", () => {
    const summary = buildVerificationSummary({
      results: allPassed(),
      startedAt: START,
      finishedAt: END,
    });
    const gate = summary.stages.find((stage) => stage.name === "word-host-evidence");
    expect(gate?.note).toMatch(/human/i);
  });

  it("assigns every stage a known owner", () => {
    const summary = buildVerificationSummary({
      results: allPassed(),
      startedAt: START,
      finishedAt: END,
    });
    const known = Object.values(STAGE_OWNERSHIP);
    summary.stages.forEach((stage) => {
      expect(known).toContain(stage.owner);
    });
  });

  it("covers every automated stage and the external gate exactly once", () => {
    const summary = buildVerificationSummary({
      results: allPassed(),
      startedAt: START,
      finishedAt: END,
    });
    expect(summary.stages).toHaveLength(VERIFICATION_GRAPH.length + 1);
  });

  it("carries the run window so a stale summary can be spotted", () => {
    const summary = buildVerificationSummary({
      results: allPassed(),
      startedAt: START,
      finishedAt: END,
    });
    expect(summary.startedAt).toBe(START);
    expect(summary.finishedAt).toBe(END);
  });

  it("serializes to JSON without losing the classification", () => {
    const summary = buildVerificationSummary({
      results: { ...allPassed(), test: false },
      startedAt: START,
      finishedAt: END,
    });
    const roundTripped = JSON.parse(JSON.stringify(summary));
    expect(roundTripped).toEqual(summary);
  });
});
