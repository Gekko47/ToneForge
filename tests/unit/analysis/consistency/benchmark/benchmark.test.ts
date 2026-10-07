import { describe, expect, it } from "vitest";
import {
  CANDIDATE_MODELS,
  PRECISION_BAR,
  renderBenchmarkReport,
  runBenchmark,
  runCandidate,
  selectCandidate,
  type CandidateReport,
} from "@/analysis/consistency/benchmark/benchmark";
import { CORPUS } from "@/analysis/consistency/benchmark/corpus";

function report(overrides: Partial<CandidateReport>): CandidateReport {
  return {
    name: "candidate",
    fixtures: [],
    dAccuracy: 0,
    precision: 0,
    recall: 0,
    falsePositiveRate: 0,
    falseNegativeRate: 0,
    eCalibration: 0,
    stability: 1,
    latencyMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    perCheck: {},
    ...overrides,
  };
}

describe("consistency benchmark corpus", () => {
  it("covers all ten checks", () => {
    const checks = new Set(CORPUS.map((fixture) => fixture.checkId));
    expect([...checks].sort()).toEqual([
      "C1",
      "C10",
      "C2",
      "C3",
      "C4",
      "C5",
      "C6",
      "C7",
      "C8",
      "C9",
    ]);
  });

  it("labels both true contradictions and legitimate differences", () => {
    const present = CORPUS.filter((fixture) => fixture.expectedPresent);
    const suppressed = CORPUS.filter((fixture) => !fixture.expectedPresent);
    expect(present.length).toBeGreaterThan(0);
    expect(suppressed.length).toBeGreaterThan(0);
    // A legitimate difference is never labelled as a conflict to present.
    suppressed.forEach((fixture) => {
      expect(fixture.expectedDOutcome).not.toBe("D-CONFLICT");
    });
  });
});

describe("consistency benchmark", () => {
  it("measures the oracle at full precision, recall, and D-accuracy", async () => {
    const oracle = CANDIDATE_MODELS.find((model) => model.name === "oracle");
    expect(oracle).toBeDefined();
    const measured = await runCandidate(oracle!);
    expect(measured.precision).toBe(1);
    expect(measured.recall).toBe(1);
    expect(measured.dAccuracy).toBe(1);
    expect(measured.stability).toBe(1);
  });

  it("shows an over-eager model presenting false positives", async () => {
    const overEager = CANDIDATE_MODELS.find((model) => model.name === "over-eager");
    const measured = await runCandidate(overEager!);
    expect(measured.precision).toBeLessThan(PRECISION_BAR);
    expect(measured.falsePositiveRate).toBeGreaterThan(0);
  });

  it("shows an under-eager model missing every conflict", async () => {
    const underEager = CANDIDATE_MODELS.find((model) => model.name === "under-eager");
    const measured = await runCandidate(underEager!);
    expect(measured.recall).toBe(0);
    expect(measured.falseNegativeRate).toBe(1);
  });

  it("shows a definition-blind model losing recall on C1 and C5", async () => {
    const blind = CANDIDATE_MODELS.find((model) => model.name === "definition-blind");
    const measured = await runCandidate(blind!);
    expect(measured.perCheck["C1"]?.recall).toBeLessThan(1);
    expect(measured.perCheck["C5"]?.recall).toBeLessThan(1);
    expect(measured.perCheck["C2"]?.recall).toBe(1);
  });

  it("selects the model with the highest recall above the presentation bar", async () => {
    const result = await runBenchmark();
    expect(result.selected?.name).toBe("oracle");
  });

  it("selects nothing when no candidate clears the presentation bar", () => {
    const selected = selectCandidate([
      report({ name: "weak", precision: 0.5, recall: 1 }),
      report({ name: "weaker", precision: 0.2, recall: 0.9 }),
    ]);
    expect(selected).toBeNull();
  });

  it("renders a report naming the selected model", async () => {
    const result = await runBenchmark();
    const markdown = renderBenchmarkReport(result);
    expect(markdown).toContain("# Consistency decision-model benchmark");
    expect(markdown).toContain("Selected: **oracle**");
    expect(markdown).toContain("| Model | Precision | Recall |");
  });
});
