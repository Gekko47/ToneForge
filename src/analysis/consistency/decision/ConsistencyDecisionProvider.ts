/**
 * Decision provider interface (R5, original §19).
 *
 * The provider evaluates a DecisionPlan and returns typed answers.
 * It does not own final D-outcome or confidence — ToneForge derives those.
 */
import type { DecisionPlan } from "../contracts/plan";
import type { EvaluationAnswer } from "../contracts/evaluation";

/** Metadata returned by the decision provider. */
export interface DecisionProviderMetadata {
  readonly provider: string;
  readonly model: string;
  readonly questionSetVersion: string;
  readonly latencyMs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
}

/** The evaluation returned by a decision provider. */
export interface ConsistencyDecisionEvaluation {
  readonly answers: readonly EvaluationAnswer[];
  readonly providerMetadata: DecisionProviderMetadata;
}

/** The decision provider interface. */
export interface ConsistencyDecisionProvider {
  readonly name: string;

  /**
   * Evaluate a decision plan.
   *
   * @param plan The compiled decision plan with typed questions and projected state
   * @param signal Optional abort signal for cancellation
   * @returns Typed answers for each question in the plan
   */
  evaluate(plan: DecisionPlan, signal?: AbortSignal): Promise<ConsistencyDecisionEvaluation>;
}
