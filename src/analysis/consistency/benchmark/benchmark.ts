/**
 * Decision-model benchmark (R7, original §38).
 *
 * Runs identical DecisionPlans through candidate decision models and measures
 * each C-check separately: per-check precision and recall, D-outcome accuracy
 * after ToneForge derivation, E-question calibration, false-positive and
 * false-negative rates, stability, latency and cost. Selection prioritises
 * precision at or above the presentation bar, because an expert report is
 * harmed more by a confident false positive than by a missed one.
 *
 * The candidates here are deterministic stand-ins, not live models: the
 * benchmark is the harness a real model is measured with, and the corpus is
 * the expert labelling it is measured against. No network call is made.
 */

import type { ConsistencyCheckId, ConfidenceProfile, DOutcome } from "../contracts";
import type { DecisionPlan } from "../contracts/plan";
import type { EvaluationAnswer } from "../contracts/evaluation";
import type {
  ConsistencyDecisionEvaluation,
  ConsistencyDecisionProvider,
} from "../decision/ConsistencyDecisionProvider";
import { QUESTION_SET_VERSION } from "../decision/questionRegistry";
import { buildEvaluationVector, deriveDOutcome } from "../comparison/dDerivation";
import { computeConfidence, meetsPresentationThreshold } from "../comparison/confidenceEngine";
import { CORPUS, type CorpusFixture } from "./corpus";

/**
 * The precision a candidate must clear to be selected.
 *
 * It is the highest per-check presentation threshold (C2 and C6 present at
 * 0.75), so a selected model's presented issues are at least as trustworthy as
 * the bar the engine itself presents at.
 */
export const PRECISION_BAR = 0.75;

/** One fixture's outcome under a candidate. */
export interface FixtureOutcome {
  readonly fixtureId: string;
  readonly checkId: ConsistencyCheckId;
  readonly expectedDOutcome: DOutcome;
  readonly derivedDOutcome: DOutcome;
  readonly expectedPresent: boolean;
  readonly presented: boolean;
  readonly confidence: ConfidenceProfile;
}

/** Precision and recall for one check. */
export interface CheckScore {
  readonly precision: number;
  readonly recall: number;
}

/** A candidate's measured performance over the corpus. */
export interface CandidateReport {
  readonly name: string;
  readonly fixtures: readonly FixtureOutcome[];
  readonly dAccuracy: number;
  readonly precision: number;
  readonly recall: number;
  readonly falsePositiveRate: number;
  readonly falseNegativeRate: number;
  /** 1 − mean |confidence − correctness|; higher is better calibrated. */
  readonly eCalibration: number;
  /** 1 when two runs present the same set, 0 otherwise. */
  readonly stability: number;
  readonly latencyMs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly perCheck: Readonly<Record<string, CheckScore>>;
}

/** The benchmark result: every candidate, and the one selected. */
export interface BenchmarkResult {
  readonly reports: readonly CandidateReport[];
  readonly selected: CandidateReport | null;
}

/** Build the DecisionPlan a fixture's unresolved questions compile to. */
function planFor(fixture: CorpusFixture): DecisionPlan {
  return {
    revision: fixture.id,
    questions: fixture.expertAnswers.map((answer) => ({
      kind: "binary" as const,
      id: answer.question,
      prompt: answer.question,
      subjectId: fixture.id,
    })),
    budget: { maxQuestions: fixture.expertAnswers.length, maxExpansions: 0 },
    allowUnredacted: false,
  };
}

/** How a candidate answers one question. */
type AnswerStrategy = (
  fixtureId: string,
  question: string,
) => { holds: boolean; confidence: number };

/**
 * Build a decision provider from an answer strategy.
 *
 * The stand-ins report a fixed latency of 0 rather than a wall-clock reading.
 * They do no I/O, so `Date.now()` around a synchronous map measures scheduler
 * noise (0 or 1 ms, varying run to run) — and the checked-in report is compared
 * byte-for-byte, so a noisy column would make it irreproducible. A real provider
 * reports its own measured latency; the harness aggregates whatever it is given.
 */
function candidate(
  name: string,
  strategy: AnswerStrategy,
  cost: { tokensIn: number; tokensOut: number },
): ConsistencyDecisionProvider {
  return {
    name,
    async evaluate(plan: DecisionPlan): Promise<ConsistencyDecisionEvaluation> {
      const answers: EvaluationAnswer[] = plan.questions.map((question) => {
        const { holds, confidence } = strategy(question.subjectId, question.id);
        return {
          question: question.id,
          answer: holds,
          confidence,
          provenance: "system_one",
        };
      });
      return {
        answers,
        providerMetadata: {
          provider: name,
          model: name,
          questionSetVersion: QUESTION_SET_VERSION,
          latencyMs: 0,
          tokensIn: cost.tokensIn,
          tokensOut: cost.tokensOut,
        },
      };
    },
  };
}

/** The expert's answer for a fixture's question, for the oracle stand-in. */
const EXPERT = new Map(
  CORPUS.map((fixture) => [
    fixture.id,
    new Map(fixture.expertAnswers.map((answer) => [answer.question, answer.holds])),
  ]),
);

function expertHolds(fixtureId: string, question: string): boolean {
  return EXPERT.get(fixtureId)?.get(question) ?? false;
}

const COST = { tokensIn: 120, tokensOut: 40 };

/**
 * The candidate models.
 *
 * `oracle` reproduces the expert labelling and is the upper bound. The other
 * three are the failure modes the spec names: `over-eager` asks generically
 * whether passages contradict and flags everything; `under-eager` misses every
 * conflict; `definition-blind` is competent except it never sees a definitional
 * conflict, so C1 and C5 recall fall.
 */
export const CANDIDATE_MODELS: readonly ConsistencyDecisionProvider[] = [
  candidate(
    "oracle",
    (fixtureId, question) => ({ holds: expertHolds(fixtureId, question), confidence: 0.95 }),
    COST,
  ),
  candidate("over-eager", () => ({ holds: true, confidence: 0.9 }), COST),
  candidate("under-eager", () => ({ holds: false, confidence: 0.9 }), COST),
  candidate(
    "definition-blind",
    (fixtureId, question) => ({
      holds: question === "E-DEFINITION-INCOMPATIBLE" ? false : expertHolds(fixtureId, question),
      confidence: 0.9,
    }),
    COST,
  ),
];

/** Evaluate one fixture under one candidate. */
async function evaluateFixture(
  provider: ConsistencyDecisionProvider,
  fixture: CorpusFixture,
): Promise<{ outcome: FixtureOutcome; evaluation: ConsistencyDecisionEvaluation }> {
  const evaluation = await provider.evaluate(planFor(fixture));
  const modelAnswers = evaluation.answers.map((answer) => ({
    question: answer.question,
    holds: answer.answer === true,
    confidence: answer.confidence,
    reason: answer.reasoning ?? "",
  }));
  const deterministicAnswers = fixture.deterministicAnswers.map((answer) => ({
    question: answer.question,
    holds: answer.holds,
    reason: answer.reason,
  }));
  const vector = buildEvaluationVector(deterministicAnswers, modelAnswers);
  const derivedDOutcome = deriveDOutcome(
    fixture.checkId,
    vector,
    modelAnswers,
    deterministicAnswers,
  );
  const confidence = computeConfidence(
    fixture.checkId,
    vector,
    modelAnswers,
    deterministicAnswers,
    derivedDOutcome,
  );
  const presented = derivedDOutcome === "D-CONFLICT" && meetsPresentationThreshold(confidence);
  return {
    outcome: {
      fixtureId: fixture.id,
      checkId: fixture.checkId,
      expectedDOutcome: fixture.expectedDOutcome,
      derivedDOutcome,
      expectedPresent: fixture.expectedPresent,
      presented,
      confidence,
    },
    evaluation,
  };
}

/** A ratio, with the value to use when the denominator is empty. */
function ratio(numerator: number, denominator: number, whenEmpty: number): number {
  return denominator === 0 ? whenEmpty : numerator / denominator;
}

/** Mean |confidence − correctness| over a fixture's model answers. */
function calibrationError(
  fixture: CorpusFixture,
  evaluation: ConsistencyDecisionEvaluation,
): number {
  const expert = new Map(fixture.expertAnswers.map((answer) => [answer.question, answer.holds]));
  const errors = evaluation.answers.map((answer) => {
    const expected = expert.get(answer.question);
    if (expected === undefined) return 0;
    const correct = (answer.answer === true) === expected ? 1 : 0;
    return Math.abs(answer.confidence - correct);
  });
  return errors.length === 0 ? 0 : errors.reduce((sum, error) => sum + error, 0) / errors.length;
}

/** Per-check precision and recall. */
function buildPerCheck(fixtures: readonly FixtureOutcome[]): Record<string, CheckScore> {
  const byCheck = new Map<string, FixtureOutcome[]>();
  fixtures.forEach((fixture) => {
    const list = byCheck.get(fixture.checkId) ?? [];
    list.push(fixture);
    byCheck.set(fixture.checkId, list);
  });
  const result: Record<string, CheckScore> = {};
  byCheck.forEach((list, checkId) => {
    const tp = list.filter((f) => f.expectedPresent && f.presented).length;
    const fp = list.filter((f) => !f.expectedPresent && f.presented).length;
    const fn = list.filter((f) => f.expectedPresent && !f.presented).length;
    result[checkId] = {
      precision: ratio(tp, tp + fp, 0),
      recall: ratio(tp, tp + fn, 1),
    };
  });
  return result;
}

/** Run one candidate over the corpus and measure it. */
export async function runCandidate(
  provider: ConsistencyDecisionProvider,
  corpus: readonly CorpusFixture[] = CORPUS,
): Promise<CandidateReport> {
  const first = await Promise.all(corpus.map((fixture) => evaluateFixture(provider, fixture)));
  const second = await Promise.all(corpus.map((fixture) => evaluateFixture(provider, fixture)));

  const fixtures = first.map((entry) => entry.outcome);

  const tp = fixtures.filter((f) => f.expectedPresent && f.presented).length;
  const fp = fixtures.filter((f) => !f.expectedPresent && f.presented).length;
  const fn = fixtures.filter((f) => f.expectedPresent && !f.presented).length;
  const tn = fixtures.filter((f) => !f.expectedPresent && !f.presented).length;
  const dCorrect = fixtures.filter((f) => f.derivedDOutcome === f.expectedDOutcome).length;

  const calibrationErrors = first.map((entry, index) => {
    const fixture = corpus[index];
    return fixture === undefined ? 0 : calibrationError(fixture, entry.evaluation);
  });
  const meanCalibrationError =
    calibrationErrors.length === 0
      ? 0
      : calibrationErrors.reduce((sum, error) => sum + error, 0) / calibrationErrors.length;

  const firstPresented = first
    .filter((entry) => entry.outcome.presented)
    .map((entry) => entry.outcome.fixtureId)
    .sort()
    .join(",");
  const secondPresented = second
    .filter((entry) => entry.outcome.presented)
    .map((entry) => entry.outcome.fixtureId)
    .sort()
    .join(",");

  return {
    name: provider.name,
    fixtures,
    dAccuracy: ratio(dCorrect, fixtures.length, 0),
    precision: ratio(tp, tp + fp, 0),
    recall: ratio(tp, tp + fn, 1),
    falsePositiveRate: ratio(fp, fp + tn, 0),
    falseNegativeRate: ratio(fn, fn + tp, 0),
    eCalibration: 1 - meanCalibrationError,
    stability: firstPresented === secondPresented ? 1 : 0,
    latencyMs: first.reduce((sum, entry) => sum + entry.evaluation.providerMetadata.latencyMs, 0),
    tokensIn: first.reduce((sum, entry) => sum + entry.evaluation.providerMetadata.tokensIn, 0),
    tokensOut: first.reduce((sum, entry) => sum + entry.evaluation.providerMetadata.tokensOut, 0),
    perCheck: buildPerCheck(fixtures),
  };
}

/**
 * Select the production candidate.
 *
 * Only candidates whose precision clears the presentation bar are eligible; a
 * model that presents nothing has not demonstrated precision, so it is not
 * eligible either. Among the eligible, the highest recall wins.
 */
export function selectCandidate(reports: readonly CandidateReport[]): CandidateReport | null {
  const eligible = reports.filter((report) => report.precision >= PRECISION_BAR);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, report) => (report.recall > best.recall ? report : best));
}

/** Run every candidate and select one. */
export async function runBenchmark(
  candidates: readonly ConsistencyDecisionProvider[] = CANDIDATE_MODELS,
  corpus: readonly CorpusFixture[] = CORPUS,
): Promise<BenchmarkResult> {
  const reports: CandidateReport[] = [];
  for (const provider of candidates) {
    reports.push(await runCandidate(provider, corpus));
  }
  return { reports, selected: selectCandidate(reports) };
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Render the benchmark as the checked-in markdown report. */
export function renderBenchmarkReport(result: BenchmarkResult): string {
  const lines: string[] = [];
  lines.push("# Consistency decision-model benchmark");
  lines.push("");
  lines.push("Generated by `runBenchmark` over the expert-labelled corpus in");
  lines.push("`src/analysis/consistency/benchmark/corpus.ts`. Selection prioritises");
  lines.push(`precision at or above the presentation bar (${PRECISION_BAR}).`);
  lines.push("");
  lines.push(
    "| Model | Precision | Recall | D-accuracy | E-calibration | FP rate | FN rate | Stability | Latency (ms) | Tokens in | Tokens out |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  result.reports.forEach((report) => {
    lines.push(
      `| ${report.name} | ${pct(report.precision)} | ${pct(report.recall)} | ${pct(
        report.dAccuracy,
      )} | ${pct(report.eCalibration)} | ${pct(report.falsePositiveRate)} | ${pct(
        report.falseNegativeRate,
      )} | ${pct(report.stability)} | ${report.latencyMs} | ${report.tokensIn} | ${
        report.tokensOut
      } |`,
    );
  });
  lines.push("");
  lines.push("## Per-check precision and recall");
  lines.push("");
  lines.push("| Model | Check | Precision | Recall |");
  lines.push("| --- | --- | --- | --- |");
  result.reports.forEach((report) => {
    Object.entries(report.perCheck).forEach(([checkId, score]) => {
      lines.push(
        `| ${report.name} | ${checkId} | ${pct(score.precision)} | ${pct(score.recall)} |`,
      );
    });
  });
  lines.push("");
  lines.push("## Selection");
  lines.push("");
  if (result.selected === null) {
    lines.push(`No candidate cleared the presentation bar of ${PRECISION_BAR}.`);
  } else {
    lines.push(
      `Selected: **${result.selected.name}** (precision ${pct(
        result.selected.precision,
      )}, recall ${pct(result.selected.recall)}).`,
    );
  }
  lines.push("");
  lines.push("## How to use this");
  lines.push("");
  lines.push("The benchmark is a **repository-side comparison harness**, not a live model");
  lines.push("evaluation. It runs identical `DecisionPlan`s through candidate");
  lines.push("`ConsistencyDecisionProvider`s and scores each on precision, recall,");
  lines.push("D-accuracy, E-calibration, false-positive and false-negative rates, stability,");
  lines.push(`latency, and token counts. Selection prioritises precision at or above the`);
  lines.push(`presentation bar (${PRECISION_BAR}), because a check that fires on everything is`);
  lines.push("worse than one that fires on nothing.");
  lines.push("");
  lines.push("- **Regenerate** by calling the exported `runBenchmark` /");
  lines.push("  `renderBenchmarkReport` from `benchmark.ts` and writing the result to this");
  lines.push("  file. There is no dedicated npm script; the harness is exercised by");
  lines.push("  `tests/unit/analysis/consistency/benchmark/benchmark.test.ts` and");
  lines.push("  `report.test.ts`.");
  lines.push("- **The candidates are synthetic.** `oracle`, `over-eager`, `under-eager`, and");
  lines.push("  `definition-blind` are deterministic doubles over the expert-labelled corpus");
  lines.push("  in `corpus.ts`. They prove the harness discriminates a good decision model");
  lines.push("  from a bad one; they are not measurements of any real provider.");
  lines.push("- **A real model is not yet scored.** Wiring a live provider into the harness");
  lines.push("  is the open calibration gate recorded in `docs/project-state.md`. Until then,");
  lines.push("  no release claim rests on these numbers.");
  lines.push("- **The report is byte-for-byte asserted** by `report.test.ts`, so a change to");
  lines.push("  the corpus or the scoring must be reflected here in the same commit.");
  lines.push("");
  return lines.join("\n");
}
