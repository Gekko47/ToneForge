/**
 * System One response mapper (R5, original §20).
 *
 * Maps the model's raw response to typed EvaluationAnswer objects.
 * Handles binary, choice, and score question types.
 * Malformed output becomes "unclear" at confidence 0.
 *
 * Parsing goes through the shared `parseModelJsonArray`, so a fenced or
 * prose-wrapped response is read the same way here as everywhere else, and a
 * response that is not JSON at all becomes "unclear" rather than a crash.
 */

import { z } from "zod";
import type { LlmResponse } from "@/ai/providers/LlmProvider";
import { parseModelJsonArray } from "@/ai/providers/modelJson";
import type { DecisionPlan, DecisionQuestion } from "@/analysis/consistency/contracts/plan";
import type { EvaluationAnswer } from "@/analysis/consistency/contracts/evaluation";

/** Raw answer from the model. */
const RawAnswerSchema = z.object({
  questionId: z.string(),
  answer: z.union([z.boolean(), z.string(), z.number()]),
  confidence: z.number().optional(),
  reasoning: z.string().optional(),
});

type RawAnswer = z.infer<typeof RawAnswerSchema>;

/** System One response mapper. */
export class SystemOneResponseMapper {
  /**
   * Whether the last `map()` call could not read the model's output as JSON.
   *
   * A response that is not JSON at all is not the same failure as a response
   * that answers some questions and omits others: the first means the model
   * ignored the output contract, the second is a partial answer. Both become
   * "unclear" answers, but only the first is worth telling the user about, so
   * the distinction is recorded here rather than inferred from the answers.
   */
  parseFailed = false;

  /** Map a model response to typed EvaluationAnswers. */
  map(response: LlmResponse, plan: DecisionPlan): EvaluationAnswer[] {
    const rawAnswers = this.parseResponse(response.text);
    this.parseFailed = rawAnswers === null;
    const answers: EvaluationAnswer[] = [];

    for (const question of plan.questions) {
      const raw = rawAnswers?.find((r) => r.questionId === question.id);
      if (raw === undefined) {
        // Missing answer → unclear at 0 confidence
        answers.push(this.unclearAnswer(question.id, "Missing from model response"));
        continue;
      }

      const answer = this.mapAnswer(question, raw);
      answers.push(answer);
    }

    return answers;
  }

  /**
   * Parse the model's JSON response through the shared tolerant parser.
   *
   * Returns `null` — not an empty array — when the text is not JSON at all, so
   * the caller can tell "the model answered nothing" from "the model answered
   * in a shape we cannot read".
   */
  private parseResponse(text: string): RawAnswer[] | null {
    return parseModelJsonArray(text, RawAnswerSchema);
  }

  /** Map a raw answer to a typed EvaluationAnswer. */
  private mapAnswer(question: DecisionQuestion, raw: RawAnswer): EvaluationAnswer {
    const confidence =
      typeof raw.confidence === "number" && raw.confidence >= 0 && raw.confidence <= 1
        ? raw.confidence
        : 0.5;

    // Validate answer type matches question type
    if (question.kind === "binary" && typeof raw.answer !== "boolean") {
      return this.unclearAnswer(
        question.id,
        `Expected boolean for binary question, got ${typeof raw.answer}`,
      );
    }
    if (question.kind === "choice" && typeof raw.answer !== "string") {
      return this.unclearAnswer(
        question.id,
        `Expected string for choice question, got ${typeof raw.answer}`,
      );
    }
    if (question.kind === "score" && typeof raw.answer !== "number") {
      return this.unclearAnswer(
        question.id,
        `Expected number for score question, got ${typeof raw.answer}`,
      );
    }

    // Validate choice is in options
    if (
      question.kind === "choice" &&
      typeof raw.answer === "string" &&
      !question.options.includes(raw.answer)
    ) {
      return this.unclearAnswer(
        question.id,
        `Choice "${raw.answer}" not in options: ${question.options.join(", ")}`,
      );
    }

    // Validate score is in range
    if (
      question.kind === "score" &&
      typeof raw.answer === "number" &&
      (raw.answer < question.min || raw.answer > question.max)
    ) {
      return this.unclearAnswer(
        question.id,
        `Score ${raw.answer} out of range [${question.min}, ${question.max}]`,
      );
    }

    return {
      question: question.id,
      answer: raw.answer,
      confidence,
      provenance: "system_one",
      reasoning: raw.reasoning,
    };
  }

  /** Create an unclear answer at 0 confidence. */
  private unclearAnswer(questionId: string, reason: string): EvaluationAnswer {
    return {
      question: questionId,
      answer: "unclear",
      confidence: 0,
      provenance: "system_one",
      reasoning: reason,
    };
  }
}
