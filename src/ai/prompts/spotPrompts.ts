import { z } from "zod";

export const SpotPromptOptionsSchema = z.object({ includeRawText: z.literal(true) });

export interface SpotPromptOptions {
  includeRawText: boolean;
}

export function buildSpotPrompt(
  operation: "spot_selection" | "spot_paragraph" | "document_editorial_review",
  context: string,
  opts: SpotPromptOptions,
): string {
  if (!opts.includeRawText) {
    throw new Error(
      "buildSpotPrompt requires includeRawText: true — raw document text must not leave the add-in without explicit user opt-in",
    );
  }
  return [
    `Review the ${operation.replace("spot_", "")} for editorial style only.`,
    "Do not invent facts, names, dates, numbers, or entities. Preserve meaning and protected text.",
    "Return JSON with findings: category, severity (info|warning|error), risk (none|low|medium|high), confidence (0-1), actual, expected, explanation, start, end, suggestedChange.",
    "Return an empty findings array when no change is justified.",
    `Context:\n${context}`,
  ].join("\n");
}

export const SpotResponseSchema = z.object({
  findings: z.array(
    z.object({
      category: z.string().trim().min(1),
      severity: z.enum(["info", "warning", "error"]),
      risk: z.enum(["none", "low", "medium", "high"]),
      confidence: z.number().min(0).max(1),
      actual: z.string().optional(),
      expected: z.string().optional(),
      explanation: z.string().optional(),
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
      suggestedChange: z.string().optional(),
    }),
  ),
});
export type SpotResponse = z.infer<typeof SpotResponseSchema>;
