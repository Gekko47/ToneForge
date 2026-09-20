/**
 * OpenAI adapter for the provider-agnostic LlmProvider interface.
 * Uses fetch directly (no SDK dependency) to keep bundle small.
 *
 * Honors `request.signal` via `AbortSignal.any()` when available, delegates
 * retry logic to `withRetry()`, and implements a real redact() that strips
 * known sensitive patterns from text before logging.
 *
 * Abort semantics:
 * - A caller-supplied `request.signal` (user abort) is NON-retryable.
 * - An internal timeout is RETRYABLE (transient).
 * The two are distinguished by tracking which signal fired, because both
 * produce a DOMException with name "AbortError".
 */

import { env } from "../../core/config/env";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./LlmProvider";
import { withRetry, type RetryOptions } from "./retry";
import { logger } from "../../shared/utils/logger";

/** Patterns that indicate sensitive content worth redacting.
 *
 * The generic long-token pattern (`[A-Za-z0-9+/]{32,}`) is intentionally
 * LAST in the list and only matches tokens that are not already caught by
 * the more specific patterns above (emails, card numbers, `sk-`/`pk-`/`rk-`/
 * `whsec-` keys, and bearer tokens). It is also anchored to require word
 * boundaries so ordinary long words are not over-redacted.
 */
const REDACT_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  {
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: "[REDACTED_EMAIL]",
  },
  { regex: /\b(?:\d[ -]*?){13,16}\b/g, replacement: "[REDACTED_CARD]" },
  // OpenAI keys are typically `sk-` followed by 20+ alphanumerics, but we also
  // catch shorter test-style keys to avoid leaking fixture data.
  { regex: /\b(sk-[A-Za-z0-9]{6,})\b/g, replacement: "[REDACTED_API_KEY]" },
  // Project keys and other bearer tokens.
  { regex: /\b((?:pk|rk|whsec)-[A-Za-z0-9]{10,})\b/g, replacement: "[REDACTED_API_KEY]" },
  { regex: /\b(?:Bearer\s+)[A-Za-z0-9._\-]{10,}\b/g, replacement: "Bearer [REDACTED_TOKEN]" },
  // Generic long hex/base64-ish secrets. Kept after the specific patterns so
  // emails/keys/bearer tokens are redacted with their own labels, and anchored
  // with word boundaries to avoid redacting ordinary long words.
  { regex: /\b([A-Za-z0-9+/]{32,}={0,2})\b/g, replacement: "[REDACTED_SECRET]" },
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
    // Track whether the *caller* aborted, as opposed to our own timeout.
    // Both produce an AbortError; only the timeout is retryable.
    const external = request.signal;

    // If the caller signal is already aborted, fail fast without touching
    // the network. This is non-retryable.
    if (external?.aborted) {
      throw new LlmError("OpenAI request aborted by caller", this.name, false);
    }

    let abortedByCaller = false;
    if (external) {
      external.addEventListener(
        "abort",
        () => {
          abortedByCaller = true;
        },
        { once: true },
      );
    }

    // Build the combined signal. Prefer AbortSignal.any() when available so
    // the fetch sees a single signal that fires on either condition.
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), this.timeoutMs);

    let signal: AbortSignal;
    if (typeof AbortSignal.any === "function") {
      signal = AbortSignal.any([timeoutController.signal, external ?? timeoutController.signal]);
    } else if (external) {
      // Fallback: link the external signal into our timeout controller.
      signal = timeoutController.signal;
      const onExternalAbort = () => timeoutController.abort();
      external.addEventListener("abort", onExternalAbort, { once: true });
      (timeoutController as unknown as { _cleanup?: () => void })._cleanup = () =>
        external.removeEventListener("abort", onExternalAbort);
    } else {
      signal = timeoutController.signal;
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
        signal,
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
      throw this.fromUnknownError(err, abortedByCaller);
    } finally {
      clearTimeout(timer);
      const cleanup = (timeoutController as unknown as { _cleanup?: () => void })._cleanup;
      if (cleanup) cleanup();
    }
  }

  private fromStatus(status: number, statusText: string): LlmError {
    const retryable = status === 429 || status >= 500;
    return new LlmError(`OpenAI HTTP ${status}: ${statusText}`, this.name, retryable);
  }

  private fromUnknownError(err: unknown, abortedByCaller: boolean): LlmError {
    if (err instanceof DOMException && err.name === "AbortError") {
      if (abortedByCaller) {
        // Caller explicitly aborted — do not retry.
        return new LlmError("OpenAI request aborted by caller", this.name, false);
      }
      // Otherwise it was our own timeout — retryable.
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
