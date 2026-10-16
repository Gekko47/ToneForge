/**
 * Retry helper for provider calls. Kept separate so engines can compose it.
 */

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  isRetryable: (err: unknown) => boolean;
  /**
   * The source of the jitter fraction, injected so a test can make the delay
   * deterministic. Defaults to `Math.random`.
   */
  random?: () => number;
  /**
   * A wait the failure itself asked for, in milliseconds.
   *
   * When a provider states a delay it has answered the question the backoff is
   * guessing at, so its value is used instead of a jittered draw — still capped by
   * `maxDelayMs`, because a provider asking for an hour must not hold the add-in.
   */
  retryAfterMs?: (err: unknown) => number | undefined;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const random = opts.random ?? Math.random;
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
      /*
       * Full jitter: a random fraction of the exponential ceiling rather than the
       * ceiling itself.
       *
       * Every add-in instance retrying a rate limit waits the same exponential
       * interval and then arrives together, which is the burst the backoff exists
       * to avoid. Spreading each wait across the whole interval is what breaks
       * the synchronisation, and it shortens the average wait as a side effect.
       */
      const ceiling = Math.min(opts.baseDelayMs * 2 ** attempt, opts.maxDelayMs);
      const requested = opts.retryAfterMs?.(err);
      const delay =
        requested === undefined
          ? Math.round(random() * ceiling)
          : Math.min(Math.max(0, requested), opts.maxDelayMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
