/**
 * Retry helper for provider calls. Kept separate so engines can compose it.
 */

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  isRetryable: (err: unknown) => boolean;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastError: unknown;
  const attempts = Array.from({ length: opts.maxRetries + 1 }, (_, i) => i);
  for (const attempt of attempts) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!opts.isRetryable(err) || attempt === opts.maxRetries) {
        throw err;
      }
      const delay = Math.min(opts.baseDelayMs * 2 ** attempt, opts.maxDelayMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
