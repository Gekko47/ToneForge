/**
 * System One response mapper (R5, original §20).
 *
 * Maps the model's raw response to typed EvaluationAnswer objects.
 * Handles binary, choice, and score question types.
 * Malformed output becomes "unclear" at confidence 0.
 */

import type { LlmResponse } from "@/ai/providers/LlmProvider";
import type { DecisionPlan, DecisionQuestion } from "@/analysis/consistency/contracts/plan";
import type { EvaluationAnswer } from "@/analysis/consistency/contracts/evaluation";

/** Raw answer from the model. */
interface RawAnswer {
  questionId: string;
  answer: boolean | string | number;
  confidence?: number;
  reasoning?: string;
}

/** System One response mapper. */
export class SystemOneResponseMapper {
  /** Map a model response to typed EvaluationAnswers. */
  map(response: LlmResponse, plan: DecisionPlan): EvaluationAnswer[] {
    const rawAnswers = this.parseResponse(response.text);
    const answers: EvaluationAnswer[] = [];

    for (const question of plan.questions) {
      const raw = rawAnswers.find((r) => r.questionId === question.id);
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

  /** Parse the model's JSON response. */
  private parseResponse(text: string): RawAnswer[] {
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(
        (item): item is RawAnswer =>
          typeof item === "object" &&
          item !== null &&
          typeof item.questionId === "string" &&
          (typeof item.answer === "boolean" ||
            typeof item.answer === "string" ||
            typeof item.answer === "number"),
      );
    } catch {
      return [];
    }
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
