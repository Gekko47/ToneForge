/**
 * Prompt builder for semantic rewriting.
 *
 * A rewrite is the most dangerous thing this add-in can do with a document, and
 * the shape of this module is the defence. It sends a user's own prose to a
 * provider and asks for different prose back, which means:
 *
 * 1. **Nothing is built without `includeRawText: true`.** The same gate the
 *    profile and deviation builders use, and for the same reason: a prompt that
 *    carries a document is a document leaving the machine. The option defaults
 *    to false and the builder throws rather than degrading, so a caller cannot
 *    get a silently text-free prompt by forgetting a flag — they get a loud
 *    failure they have to resolve deliberately.
 *
 * 2. **The model must quote what it rewrote.** `anchor` is required, not
 *    optional. A rewrite that cannot be matched back to an exact span of the
 *    document has no precondition, and a change without a precondition is one
 *    the apply gate will refuse anyway — so asking for the quote here moves the
 *    burden onto the model at the only point where it can still see the text.
 *    The engine verifies that quote rather than trusting it.
 *
 * 3. **The model must say why.** The user is being asked to approve a change to
 *    their own writing. A rewrite with no stated reason is one they can only
 *    accept or reject on vibes.
 *
 * 4. **Confidence is required, not inferred.** Rewriting prose is the least
 *    mechanical thing here. Below the actionable threshold the engine reports the
 *    rewrite as advisory and it cannot become a change without the user acting
 *    on it deliberately.
 */

import { z } from "zod";

export interface RewritePromptOptions {
  includeRawText: boolean;
}

export const REWRITE_CONSENT_ERROR =
  "buildRewritePrompt requires includeRawText: true — raw document text must not leave the " +
  "add-in for a semantic rewrite without explicit user opt-in";

/**
 * Expected JSON shape returned by the LLM for `buildRewritePrompt`.
 *
 * Parsed defensively: unknown fields are stripped, and a missing or malformed
 * required field produces a typed error rather than a half-built rewrite.
 */
export const RewriteResponseSchema = z.object({
  /** The proposed replacement text. */
  rewritten: z.string().trim().min(1),
  /**
   * A verbatim substring of `selectedText` that the rewrite replaces.
   *
   * Usually the whole selection, but not necessarily: a model asked to fix one
   * clause may quote only that clause, and the engine anchors the change to the
   * quote rather than to the selection.
   */
  anchor: z.string().trim().min(1),
  /** Why the rewrite preserves the author's meaning. Shown before approval. */
  rationale: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
});

export type RewriteResponse = z.infer<typeof RewriteResponseSchema>;

/**
 * Build the rewrite prompt.
 *
 * `semantic` is the profile's learned semantic style — tone, voice, register,
 * rhetorical style — and is sent as JSON rather than prose so the model reads
 * the same values the pane displays. It carries no document text of its own, but
 * the selection does, so the gate applies to the whole call.
 */
export function buildRewritePrompt(
  semantic: unknown,
  selectedText: string,
  opts: RewritePromptOptions = { includeRawText: false },
): string {
  if (!opts.includeRawText) {
    throw new Error(REWRITE_CONSENT_ERROR);
  }
  const selection = selectedText.trim();
  if (selection.length === 0) {
    throw new Error(
      "buildRewritePrompt requires the text to rewrite — an empty selection has nothing to rewrite",
    );
  }
  return [
    "Rewrite the text below so that it matches the target semantic style.",
    "This is a style rewrite, not a content edit: preserve the author's claims, names, figures, and",
    "intent exactly. Change only how it is said.",
    "",
    "Target semantic style (JSON):",
    JSON.stringify(semantic),
    "",
    "Return a JSON object with exactly these keys:",
    "rewritten (string) — the replacement text;",
    "anchor (string) — copied character for character from the text below;",
    "rationale (string) — one sentence on why the rewrite preserves the meaning;",
    "confidence (number 0-1) — how confident you are that this preserves the author's intent.",
    "Do not include any explanation outside the JSON.",
    "",
    "The anchor must appear exactly once in the text below. If your rewrite changes a span you",
    "cannot quote unambiguously, quote the whole selection instead. Never paraphrase the anchor.",
    "",
    "Text to rewrite:",
    selection,
  ].join("\n");
}
