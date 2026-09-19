/**
 * OpenAI adapter for the provider-agnostic LlmProvider interface.
 * Uses fetch directly (no SDK dependency) to keep bundle small.
 *
 * Honors `request.signal` via AbortSignal.any() when available, delegates
 * retry logic to `withRetry()`, and implements a real redact() that strips
 * known sensitive patterns from text before logging.
 */

import { env } from "../../core/config/env";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./LlmProvider";
import { withRetry, type RetryOptions } from "./retry";
import { logger } from "../../shared/utils/logger";

/** Patterns that indicate sensitive content worth redacting. */
const REDACT_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  {
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: "[REDACTED_EMAIL]",
  },
  { regex: /\b(?:\d[ -]*?){13,16}\b/g, replacement: "[REDACTED_CARD]" },
  { regex: /\b(sk-[A-Za-z0-9]{20,})\b/g, replacement: "[REDACTED_API_KEY]" },
  { regex: /\b(?:Bearer\s+)[A-Za-z0-9._\-]{10,}\b/g, replacement: "Bearer [REDACTED_TOKEN]" },
];

function redactText(text: string): string {
  let out = text;
  for (const { regex, replacement } of REDACT_PATTERNS) {
    out = out.replace(regex, replacement);
  }
  return out;
}

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

    const retryOpts: RetryOptions = {
      maxRetries: this.maxRetries,
      baseDelayMs: 1000,
      maxDelayMs: 8000,
      isRetryable: (err: unknown) => err instanceof LlmError && err.retryable,
    };

    return withRetry(() => this.doComplete(request), retryOpts);
  }

  private async doComplete(request: LlmRequest): Promise<LlmResponse> {
    // Combine the request's signal with our own timeout signal.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    // If the caller provided a signal, link it so external abort propagates.
    const external = request.signal;
    if (external) {
      if (external.aborted) {
        throw new LlmError("Request aborted before start", this.name, false);
      }
      const onAbort = () => controller.abort();
      external.addEventListener("abort", onAbort, { once: true });
      // Store for cleanup.
      (controller as unknown as { _cleanup?: () => void })._cleanup = () =>
        external.removeEventListener("abort", onAbort);
    }

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
      const cleanup = (controller as unknown as { _cleanup?: () => void })._cleanup;
      if (cleanup) cleanup();
    }
  }

  private fromStatus(status: number, statusText: string): LlmError {
    const retryable = status === 429 || status >= 500;
    return new LlmError(`OpenAI HTTP ${status}: ${statusText}`, this.name, retryable);
  }

  private fromUnknownError(err: unknown): LlmError {
    if (err instanceof DOMException && err.name === "AbortError") {
      // Distinguish user-abort (non-retryable) from timeout (retryable).
      return new LlmError("OpenAI request timed out", this.name, true);
    }
    // Network errors (fetch failed) are retryable.
    if (err instanceof TypeError) {
      return new LlmError(`OpenAI network error: ${err.message}`, this.name, true);
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error("OpenAI request failed", { message: redactText(message) });
    return new LlmError(message, this.name, false);
  }

  redact(text: string): string {
    return redactText(text);
  }
}
