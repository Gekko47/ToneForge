/**
 * Shared fence/prose-tolerant, Zod-validated model-JSON parser.
 *
 * Models routinely wrap JSON in ```json fences, prepend prose ("Here is the
 * extraction:"), or append commentary. Discarding an otherwise valid response
 * over formatting is a refusal the user cannot act on. This module is the
 * single implementation of that tolerance so every caller behaves identically.
 *
 * Unparseable output is "not a response", not a crash: returning `null` lets
 * the caller produce one clear message rather than surfacing a SyntaxError with
 * a character offset in it.
 *
 * Boundary rule: this module imports only `zod`. It is Office-free, AI-free,
 * and UI-free.
 */

import { z } from "zod";

/**
 * Extract the first JSON object or array from arbitrary model output.
 *
 * Handles:
 * - ```` ```json ... ``` ```` fenced blocks
 * - Prose before the JSON ("Here are the claims:")
 * - Prose after the JSON ("Let me know if you need changes.")
 * - Bare JSON
 */
function extractJsonBody(text: string): string {
  // Try a fenced block first.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;

  // Find the first { or [ and the last } or ].
  const start = candidate.search(/[{[]/);
  if (start === -1) return candidate;
  const end = candidate.search(/[}\]][^}\]]*$/);
  if (end === -1) return candidate.slice(start);
  return candidate.slice(start, end + 1);
}

/**
 * Parse and validate a model response against a Zod schema.
 *
 * Returns the parsed value, or `null` when the output is not valid JSON or
 * does not satisfy the schema. Never throws.
 */
export function parseModelJson<T extends z.ZodTypeAny>(text: string, schema: T): z.infer<T> | null {
  const body = extractJsonBody(text);
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const result = schema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Parse a model response into an array, tolerating a single object wrapped
 * in an array by the model.
 *
 * Some models return `{ "claims": [...] }` when asked for an array; others
 * return `[...]` directly. This normalises both to an array.
 */
export function parseModelJsonArray<T extends z.ZodTypeAny>(
  text: string,
  itemSchema: T,
): z.infer<T>[] | null {
  const body = extractJsonBody(text);
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  // Direct array.
  if (Array.isArray(raw)) {
    const result = z.array(itemSchema).safeParse(raw);
    return result.success ? result.data : null;
  }
  // Wrapped object: { "items": [...] } or { "claims": [...] } etc.
  if (raw !== null && typeof raw === "object") {
    for (const value of Object.values(raw as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        const result = z.array(itemSchema).safeParse(value);
        if (result.success) return result.data;
      }
    }
  }
  return null;
}
