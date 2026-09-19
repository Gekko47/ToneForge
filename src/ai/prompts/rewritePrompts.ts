export function buildRewritePrompt(text: string, instructions: string): string {
  return [
    "Rewrite the following text preserving its meaning while applying the style instructions.",
    "Return ONLY the rewritten text, no commentary.",
    `Instructions: ${instructions}`,
    "Text:",
    text,
  ].join("\n");
}
