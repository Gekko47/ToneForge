/**
 * Retry helper for provider calls. Kept separate so engines can compose it.
 */

/** One attempt's timing, reported to `onAttempt`. */
export interface RetryAttempt {
  /** Zero-based position of this attempt in the sequence. */
  index: number;
  /** Milliseconds the attempt itself took. */
  durationMs: number;
  /** Milliseconds waited before this attempt; zero for the first. */
  waitMs: number;
  /** Whether the attempt resolved or threw. */
  outcome: "ok" | "error";
}

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
  /**
   * Reported once per attempt, after it settles.
   *
   * The retry policy is otherwise invisible: a caller sees one call and one total,
   * so "the provider is slow" and "we retried three times, each hanging until the
   * timeout" look identical. This is how each attempt's own duration and the
   * backoff before it reach the caller that wants to attribute the wait.
   */
  onAttempt?: (attempt: RetryAttempt) => void;
  /** Injected so a test can drive the measured durations. Defaults to `Date.now`. */
  now?: () => number;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const random = opts.random ?? Math.random;
  const now = opts.now ?? (() => Date.now());
  let lastError: unknown;
  // The wait before the *next* attempt, so an attempt reports the backoff that
  // preceded it rather than the one that follows it.
  let waitMs = 0;
  const attempts = Array.from({ length: opts.maxRetries + 1 }, (_, i) => i);
  for (const attempt of attempts) {
    const startedAt = now();
    try {
      const value = await fn();
      opts.onAttempt?.({ index: attempt, durationMs: now() - startedAt, waitMs, outcome: "ok" });
      return value;
    } catch (err) {
      const durationMs = now() - startedAt;
      lastError = err;
      if (!opts.isRetryable(err) || attempt === opts.maxRetries) {
        opts.onAttempt?.({ index: attempt, durationMs, waitMs, outcome: "error" });
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
      opts.onAttempt?.({ index: attempt, durationMs, waitMs, outcome: "error" });
      waitMs = delay;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
