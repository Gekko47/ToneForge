/**
 * Anthropic adapter (Phase 4), gateway-routed.
 *
 * Normalizes the Anthropic Messages protocol behind the provider-agnostic
 * `LlmProvider` interface. The gateway performs the provider-native call; this
 * adapter owns only the request shape and the response normalization, so the
 * rest of the application never sees a provider-specific message format.
 *
 * Anthropic uses a `system` field outside the `messages` array and reports
 * token usage as `input_tokens`/`output_tokens`. Both differences are handled
 * here so callers keep using the provider-agnostic contract.
 */

import { GatewayRoutedAdapter, type GatewayAdapterOptions } from "./gatewayAdapter";
import type { LlmRequest, LlmResponse } from "./LlmProvider";
import {
  ProviderConnectionSchema,
  type ProviderConnection,
} from "../../core/domain/ProviderConnection";

export type AnthropicAdapterOptions = GatewayAdapterOptions;

export class AnthropicAdapter extends GatewayRoutedAdapter {
  readonly name = "anthropic";

  constructor(opts: AnthropicAdapterOptions) {
    super(opts);
  }

  protected buildRequestBody(request: LlmRequest): unknown {
    const model = this.connection.selectedModel;
    return {
      ...(model ? { model } : {}),
      // Anthropic carries the system prompt as a top-level field rather than a
      // message with role "system".
      ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
      messages: [{ role: "user", content: request.prompt }],
      temperature: request.temperature ?? 0.3,
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    };
  }

  protected parseResponse(payload: unknown): LlmResponse {
    const json = payload as {
      content?: Array<{ type?: string; text?: string }>;
      model?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    // The response is a content-block array; concatenate the text blocks.
    const text = (json.content ?? [])
      .filter((block) => block.type === "text" || typeof block.text === "string")
      .map((block) => block.text ?? "")
      .join("");

    const usage: LlmResponse["usage"] = {};
    if (json.usage?.input_tokens !== undefined) usage.inputTokens = json.usage.input_tokens;
    if (json.usage?.output_tokens !== undefined) usage.outputTokens = json.usage.output_tokens;

    return {
      text,
      model: json.model ?? this.connection.selectedModel ?? "unknown",
      usage,
    };
  }
}

/** Build an Anthropic connection record for a gateway-issued reference. */
export function createAnthropicConnection(
  connectionId: string,
  overrides: Partial<Record<string, unknown>> = {},
): ProviderConnection {
  return ProviderConnectionSchema.parse({
    connectionId,
    provider: "anthropic",
    authMode: "oauth",
    status: "connected",
    ...overrides,
  });
}
