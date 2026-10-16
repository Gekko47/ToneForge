/**
 * The retry helper.
 *
 * The wait is randomised by design — an exponential backoff every instance shares
 * is the burst the backoff exists to avoid — so these tests inject the jitter
 * fraction and assert the ceiling it is drawn from, which is the deterministic
 * part, rather than an absolute delay.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { withRetry } from "../../../../src/ai/providers/retry";

/** Runs the promise to its settled value, so a rejection is not left unhandled. */
function settled<T>(promise: Promise<T>): Promise<unknown> {
  return promise.catch((err: unknown) => err);
}

describe("withRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the first success without waiting", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100, isRetryable: () => true }),
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failure the predicate refuses", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fatal"));
    await expect(
      withRetry(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10, isRetryable: () => false }),
    ).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("waits the exponential ceiling, doubling between attempts", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error("transient"));
    const done = settled(
      withRetry(fn, {
        maxRetries: 2,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        isRetryable: () => true,
        // A full draw makes the wait the ceiling itself: 100, then 200.
        random: () => 1,
      }),
    );

    await vi.advanceTimersByTimeAsync(99);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(3);

    await expect(done).resolves.toBeInstanceOf(Error);
  });

  it("draws a fraction of the ceiling, so the delay is not the ceiling", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error("transient"));
    const done = settled(
      withRetry(fn, {
        maxRetries: 1,
        baseDelayMs: 1000,
        maxDelayMs: 8000,
        isRetryable: () => true,
        random: () => 0,
      }),
    );

    // A zero draw retries immediately rather than after the whole second. This is
    // the property that breaks the synchronisation between instances.
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(2);
    await expect(done).resolves.toBeInstanceOf(Error);
  });

  it("waits the delay the failure asked for, instead of a jittered draw", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error("rate limited"));
    const done = settled(
      withRetry(fn, {
        maxRetries: 1,
        baseDelayMs: 10,
        maxDelayMs: 8000,
        isRetryable: () => true,
        // A zero draw would retry at once; the provider's 500ms is what is honoured.
        random: () => 0,
        retryAfterMs: () => 500,
      }),
    );

    await vi.advanceTimersByTimeAsync(499);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);

    await expect(done).resolves.toBeInstanceOf(Error);
  });

  it("caps a requested delay, so a provider cannot hold the add-in", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error("rate limited"));
    const done = settled(
      withRetry(fn, {
        maxRetries: 1,
        baseDelayMs: 10,
        maxDelayMs: 1000,
        isRetryable: () => true,
        retryAfterMs: () => 60 * 60 * 1000,
      }),
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    await expect(done).resolves.toBeInstanceOf(Error);
  });

  it("never waits longer than the ceiling", async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new Error("transient"));
    const done = settled(
      withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 1500,
        isRetryable: () => true,
        random: () => 1,
      }),
    );

    // Ceilings are 1000, then 2000 and 4000 both clamped to 1500.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(fn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1500);
    expect(fn).toHaveBeenCalledTimes(4);

    await expect(done).resolves.toBeInstanceOf(Error);
  });
});
