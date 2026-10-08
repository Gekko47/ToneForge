/**
 * System One compiler (R5, original §20).
 *
 * Compiles a DecisionPlan into a model request:
 * - binary → yes/no probability
 * - choice → bounded choice distribution
 * - score → ordered score
 *
 * The C1–C10 engine must not contain model-specific request logic.
 *
 * Exact evidence is gated on the plan's `allowUnredacted` flag (D13): when the
 * run did not opt out of redaction, the evidence text is redacted before it is
 * placed in the prompt, so the compiler can never be the path that leaks exact
 * document text the user did not agree to send.
 */

import type { DecisionPlan } from "@/analysis/consistency/contracts/plan";
import { redactSensitiveText } from "@/shared/utils/redaction";

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

    // Expanded context, keyed by candidate, from the single expansion pass.
    const expandedByCandidate = new Map<string, string[]>();
    plan.expandedContext.forEach((entry) => {
      const list = expandedByCandidate.get(entry.candidateId) ?? [];
      list.push(`    [${entry.kind}] ${entry.content}`);
      expandedByCandidate.set(entry.candidateId, list);
    });

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
        // Exact evidence only when the run opted out of redaction; otherwise
        // the text is redacted, never dropped silently and never sent raw.
        if (state.left.evidence !== undefined) {
          parts.push(`    Left evidence: ${this.evidence(state.left.evidence.exactText, plan)}`);
        }
        if (state.right.evidence !== undefined) {
          parts.push(`    Right evidence: ${this.evidence(state.right.evidence.exactText, plan)}`);
        }
        if (state.diff.differences.length > 0) {
          parts.push(`    Differences: ${state.diff.differences.length}`);
        }
      }

      // Expanded context retrieved for this candidate, if any.
      const expanded = expandedByCandidate.get(question.subjectId);
      if (expanded !== undefined && expanded.length > 0) {
        parts.push("  Expanded context:");
        expanded.forEach((line) => parts.push(line));
      }

      parts.push("");
    }

    parts.push("Answer as JSON array: [{questionId, answer, confidence, reasoning?}]");

    return parts.join("\n");
  }

  /** Exact evidence when unredacted is allowed, redacted text otherwise. */
  private evidence(text: string, plan: DecisionPlan): string {
    return plan.allowUnredacted ? text : redactSensitiveText(text);
  }
}
