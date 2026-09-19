/**
 * Prompt builder for semantic text rewriting.
 * Redaction header included: raw document text must not leave the add-in
 * unless the user explicitly opts in.
 */

export interface RewritePromptOptions {
  includeRawText: boolean;
}

export function buildRewritePrompt(
  text: string,
  instructions: string,
  opts: RewritePromptOptions = { includeRawText: false },
): string {
  if (!opts.includeRawText) {
    throw new Error(
      "buildRewritePrompt requires includeRawText: true — raw document text must not leave the add-in without explicit user opt-in",
    );
  }
  return [
    "Rewrite the following text preserving its meaning while applying the style instructions.",
    "Return ONLY the rewritten text, no commentary.",
    `Instructions: ${instructions}`,
    "Text:",
    text,
  ].join("\n");
}
