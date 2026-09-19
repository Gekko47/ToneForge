/**
 * Simple Result<T,E> type for typed error handling in deterministic engines.
 */

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function mapResult<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: fn(r.value) };
}

export function unwrap<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw r.error;
  return r.value;
}
