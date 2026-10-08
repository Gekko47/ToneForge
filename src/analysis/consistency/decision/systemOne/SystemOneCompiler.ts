/**
 * System One compiler (R5, original §20).
 *
 * Compiles a DecisionPlan into a model request:
 * - binary → yes/no probability
 * - choice → bounded choice distribution
 * - score → ordered score
 *
 * The C1–C10 engine must not contain model-specific request logic.
 */

import type { DecisionPlan } from "@/analysis/consistency/contracts/plan";

/** Compiled model request. */
export interface CompiledRequest {
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly temperature: number;
  readonly maxTokens: number;
}

/** System One compiler. */
export class SystemOneCompiler {
  /** Compile a DecisionPlan into a model request. */
  compile(plan: DecisionPlan): CompiledRequest {
    const systemPrompt = this.buildSystemPrompt();
    const prompt = this.buildPrompt(plan);

    return {
      prompt,
      systemPrompt,
      temperature: 0.1, // Low temperature for consistent decisions
      maxTokens: 4096,
    };
  }

  /** Build the system prompt. */
  private buildSystemPrompt(): string {
    return `You are a consistency decision model for construction delay expert reports.
Your task is to answer typed questions about claim comparisons.
Each question is one of: binary (yes/no), choice (from options), or score (numeric range).
Answer only the questions asked. Do not add explanations unless requested.
Output format: JSON array of answers matching the question order.`;
  }

  /** Build the user prompt from the plan. */
  private buildPrompt(plan: DecisionPlan): string {
    const parts: string[] = [];

    parts.push(`Revision: ${plan.revision}`);
    parts.push(`Questions: ${plan.questions.length}`);
    parts.push(
      `Budget: maxQuestions=${plan.budget.maxQuestions}, maxExpansions=${plan.budget.maxExpansions}`,
    );
    parts.push(`Allow unredacted: ${plan.allowUnredacted}`);
    parts.push("");

    // Build a map from candidateId to projected state for context lookup
    const stateByCandidate = new Map(plan.projectedStates.map((s) => [s.candidateId, s]));

    for (const question of plan.questions) {
      parts.push(`Question ${question.id} (${question.kind}):`);
      parts.push(`  Subject: ${question.subjectId}`);
      parts.push(`  Prompt: ${question.prompt}`);

      if (question.kind === "choice") {
        parts.push(`  Options: ${question.options.join(", ")}`);
      } else if (question.kind === "score") {
        parts.push(`  Range: ${question.min} to ${question.max}`);
      }

      // Include the projected state context for this question's candidate
      const state = stateByCandidate.get(question.subjectId);
      if (state !== undefined) {
        parts.push("  Context:");
        parts.push(`    Check: ${state.checkId}`);
        parts.push(`    Left claim: ${state.left.predicate}`);
        parts.push(`    Right claim: ${state.right.predicate}`);
        if (state.left.evidence !== undefined) {
          parts.push(`    Left evidence: ${state.left.evidence.exactText}`);
        }
        if (state.right.evidence !== undefined) {
          parts.push(`    Right evidence: ${state.right.evidence.exactText}`);
        }
        if (state.diff.differences.length > 0) {
          parts.push(`    Differences: ${state.diff.differences.length}`);
        }
      }

      parts.push("");
    }

    parts.push("Answer as JSON array: [{questionId, answer, confidence, reasoning?}]");

    return parts.join("\n");
  }
}
