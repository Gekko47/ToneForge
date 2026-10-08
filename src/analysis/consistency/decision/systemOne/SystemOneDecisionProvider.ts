/**
 * System One decision provider (R5, original §20).
 *
 * Adapts the configured LLM provider to the ConsistencyDecisionProvider
 * interface. Uses the SystemOneCompiler and SystemOneResponseMapper to
 * translate between the typed DecisionPlan and the model's native format.
 */

import {
  LlmError,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from "@/ai/providers/LlmProvider";
import type {
  ConsistencyDecisionProvider,
  ConsistencyDecisionEvaluation,
  DecisionProviderMetadata,
} from "../ConsistencyDecisionProvider";
import type { DecisionPlan } from "@/analysis/consistency/contracts/plan";
import { SystemOneCompiler } from "@/analysis/consistency/decision/systemOne/SystemOneCompiler";
import { SystemOneResponseMapper } from "@/analysis/consistency/decision/systemOne/SystemOneResponseMapper";
import { QUESTION_SET_VERSION } from "@/analysis/consistency/decision/questionRegistry";

const DEFAULT_TIMEOUT_MS = 30_000;

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

    // Call the provider, racing against a timeout so a hung provider cannot
    // block the run indefinitely.
    const llmRequest: LlmRequest = {
      prompt: request.prompt,
      systemPrompt: request.systemPrompt,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    };
    if (signal !== undefined) {
      llmRequest.signal = signal;
    }
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () =>
          reject(
            new LlmError(
              `Decision provider timed out after ${DEFAULT_TIMEOUT_MS}ms`,
              this.provider.name,
              false,
            ),
          ),
        DEFAULT_TIMEOUT_MS,
      );
    });

    let response: LlmResponse;
    try {
      response = await Promise.race([this.provider.complete(llmRequest), timeout]);
    } finally {
      // Clear the timer whether the provider won the race or the timeout fired,
      // so a fast provider does not leave a pending timer behind.
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }

    // Map the response back to typed answers
    const answers = this.mapper.map(response, plan);

    const latencyMs = Date.now() - startTime;

    const metadata: DecisionProviderMetadata = {
      provider: this.provider.name,
      model: response.model,
      questionSetVersion: QUESTION_SET_VERSION,
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
