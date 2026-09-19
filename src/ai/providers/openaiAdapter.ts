/**
 * OpenAI adapter for the provider-agnostic LlmProvider interface.
 * Uses fetch directly (no SDK dependency) to keep bundle small.
 */

import { env } from "../../core/config/env";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./LlmProvider";
import { logger } from "../../shared/utils/logger";

export class OpenAiAdapter implements LlmProvider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(
    opts: Partial<{
      apiKey: string;
      baseUrl: string;
      model: string;
      timeoutMs: number;
      maxRetries: number;
    }> = {},
  ) {
    this.apiKey = opts.apiKey ?? env.OPENAI_API_KEY ?? "";
    this.baseUrl = opts.baseUrl ?? env.OPENAI_BASE_URL;
    this.model = opts.model ?? env.OPENAI_MODEL;
    this.timeoutMs = opts.timeoutMs ?? env.OPENAI_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? env.OPENAI_MAX_RETRIES;
  }

  get configured(): boolean {
    return this.apiKey.length > 0;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (!this.configured) {
      throw new LlmError("OpenAI adapter is not configured (missing API key)", this.name, false);
    }

    let lastError: LlmError | null = null;
    const attempts = Array.from({ length: this.maxRetries + 1 }, (_, i) => i);
    for (const attempt of attempts) {
      try {
        return await this.doComplete(request);
      } catch (err) {
        const error = err instanceof LlmError ? err : this.fromUnknownError(err);
        lastError = error;
        if (!error.retryable || attempt === this.maxRetries) {
          throw error;
        }
        const delay = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError ?? new LlmError("Unknown failure", this.name, false);
  }

  private async doComplete(request: LlmRequest): Promise<LlmResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            ...(request.systemPrompt ? [{ role: "system", content: request.systemPrompt }] : []),
            { role: "user", content: request.prompt },
          ],
          temperature: request.temperature ?? 0.3,
          max_tokens: request.maxTokens,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw this.fromStatus(res.status, res.statusText);
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const text = json.choices?.[0]?.message?.content ?? "";
      const usage: LlmResponse["usage"] = {};
      if (json.usage?.prompt_tokens !== undefined) usage.inputTokens = json.usage.prompt_tokens;
      if (json.usage?.completion_tokens !== undefined)
        usage.outputTokens = json.usage.completion_tokens;

      return {
        text,
        model: json.model ?? this.model,
        usage,
      };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw this.fromUnknownError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  private fromStatus(status: number, statusText: string): LlmError {
    const retryable = status === 429 || status >= 500;
    return new LlmError(`OpenAI HTTP ${status}: ${statusText}`, this.name, retryable);
  }

  private fromUnknownError(err: unknown): LlmError {
    if (err instanceof DOMException && err.name === "AbortError") {
      return new LlmError("OpenAI request timed out", this.name, true);
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error("OpenAI request failed", { message });
    return new LlmError(message, this.name, false);
  }

  redact(text: string): string {
    return text;
  }
}
