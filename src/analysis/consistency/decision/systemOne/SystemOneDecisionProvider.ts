/**
 * System One decision provider (R5, original §20).
 *
 * Adapts the configured LLM provider to the ConsistencyDecisionProvider
 * interface. Uses the SystemOneCompiler and SystemOneResponseMapper to
 * translate between the typed DecisionPlan and the model's native format.
 */

import type { LlmProvider, LlmRequest } from "@/ai/providers/LlmProvider";
import type {
  ConsistencyDecisionProvider,
  ConsistencyDecisionEvaluation,
  DecisionProviderMetadata,
} from "../ConsistencyDecisionProvider";
import type { DecisionPlan } from "@/analysis/consistency/contracts/plan";
import { SystemOneCompiler } from "@/analysis/consistency/decision/systemOne/SystemOneCompiler";
import { SystemOneResponseMapper } from "@/analysis/consistency/decision/systemOne/SystemOneResponseMapper";

/** System One decision provider implementation. */
export class SystemOneDecisionProvider implements ConsistencyDecisionProvider {
  readonly name = "system-one";

  constructor(
    private readonly provider: LlmProvider,
    private readonly compiler: SystemOneCompiler = new SystemOneCompiler(),
    private readonly mapper: SystemOneResponseMapper = new SystemOneResponseMapper(),
  ) {}

  async evaluate(plan: DecisionPlan, signal?: AbortSignal): Promise<ConsistencyDecisionEvaluation> {
    const startTime = Date.now();

    // Compile the plan into a model request
    const request = this.compiler.compile(plan);

    // Call the provider
    const llmRequest: LlmRequest = {
      prompt: request.prompt,
      systemPrompt: request.systemPrompt,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    };
    if (signal !== undefined) {
      llmRequest.signal = signal;
    }
    const response = await this.provider.complete(llmRequest);

    // Map the response back to typed answers
    const answers = this.mapper.map(response, plan);

    const latencyMs = Date.now() - startTime;

    const metadata: DecisionProviderMetadata = {
      provider: this.provider.constructor.name,
      model: "system-one",
      questionSetVersion: "1.0",
      latencyMs,
      tokensIn: response.usage?.inputTokens ?? 0,
      tokensOut: response.usage?.outputTokens ?? 0,
    };

    return {
      answers,
      providerMetadata: metadata,
    };
  }
}
