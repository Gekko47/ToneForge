/**
 * OpenRouter adapter (Phase 4), gateway-routed.
 *
 * OpenRouter exposes an OpenAI-compatible chat-completions protocol, so this
 * adapter speaks that shape. The difference that matters is not the protocol
 * but the credential: the user supplies an OpenRouter API key once, it goes
 * straight to the gateway, and the add-in retains only the opaque connection
 * reference. The key is never stored, logged, or placed in a URL.
 *
 * The configured base URL is recorded on the connection with its policy
 * classification, and the shared base refuses a `policyRejected` origin, so a
 * syntactically valid but unapproved self-hosted endpoint cannot be used.
 */

import { GatewayRoutedAdapter, type GatewayAdapterOptions } from "./gatewayAdapter";
import type { LlmRequest, LlmResponse } from "./LlmProvider";
import {
  ProviderConnectionSchema,
  type ProviderConnection,
} from "../../core/domain/ProviderConnection";

export type OpenRouterAdapterOptions = GatewayAdapterOptions;

export class OpenRouterAdapter extends GatewayRoutedAdapter {
  readonly name = "openrouter";

  constructor(opts: OpenRouterAdapterOptions) {
    super(opts);
  }

  protected buildRequestBody(request: LlmRequest): unknown {
    const model = this.connection.selectedModel;
    return {
      ...(model ? { model } : {}),
      messages: [
        ...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
        { role: "user", content: request.prompt },
      ],
      temperature: request.temperature ?? 0.3,
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    };
  }

  protected parseResponse(payload: unknown): LlmResponse {
    const json = payload as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const usage: LlmResponse["usage"] = {};
    if (json.usage?.prompt_tokens !== undefined) usage.inputTokens = json.usage.prompt_tokens;
    if (json.usage?.completion_tokens !== undefined) {
      usage.outputTokens = json.usage.completion_tokens;
    }
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      model: json.model ?? this.connection.selectedModel ?? "unknown",
      usage,
    };
  }
}

/** Build an OpenRouter connection record for a gateway-issued reference. */
export function createOpenRouterConnection(
  connectionId: string,
  overrides: Partial<Record<string, unknown>> = {},
): ProviderConnection {
  return ProviderConnectionSchema.parse({
    connectionId,
    provider: "openrouter",
    authMode: "brokerApiKey",
    status: "connected",
    ...overrides,
  });
}
