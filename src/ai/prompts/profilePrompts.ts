/**
 * Prompt builders for semantic style profiling.
 * Prompts are redacted before sending: no document text leaves the add-in
 * unless the user explicitly opts in.
 */

import { z } from "zod";

export interface ProfilePromptOptions {
  includeRawText: boolean;
}

/**
 * Expected JSON shape returned by the LLM for `buildProfilePrompt`.
 * Parsed defensively: unknown fields are stripped and missing required
 * fields produce a typed error so callers can surface a clean failure
 * instead of trusting raw model output.
 */
export const ProfileResponseSchema = z.object({
  tone: z.string().trim().min(1),
  voice: z.string().trim().min(1),
  formality: z.number().min(0).max(100),
  readingGradeTarget: z.number().min(0).max(20).nullable(),
  preferredSentenceLength: z.number().min(5).max(60),
  vocabularyRegister: z.enum(["simple", "standard", "technical", "academic"]),
  rhetoricalStyle: z.string().trim().min(1),
  avoidWords: z.array(z.string()).default([]),
});

export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;

/**
 * Expected JSON shape returned by the LLM for `buildDeviationPrompt`.
 */
export const DeviationResponseSchema = z.object({
  deviation: z.string().trim().min(1),
  severity: z.enum(["low", "medium", "high"]),
  suggestion: z.string().trim().min(1),
});

export type DeviationResponse = z.infer<typeof DeviationResponseSchema>;

export function buildProfilePrompt(
  sampleText: string,
  constraints: string[] = [],
  opts: ProfilePromptOptions = { includeRawText: false },
): string {
  if (!opts.includeRawText) {
    throw new Error(
      "buildProfilePrompt requires includeRawText: true — raw document text must not leave the add-in without explicit user opt-in",
    );
  }
  return [
    "Analyze the following writing sample and produce a concise style profile.",
    "Return a JSON object with exactly these keys: tone, voice, formality (0-100),",
    "readingGradeTarget (nullable number), preferredSentenceLength (number),",
    "vocabularyRegister (one of: simple, standard, technical, academic),",
    "rhetoricalStyle (string), avoidWords (array of strings).",
    "Do not include any explanation outside the JSON.",
    constraints.length > 0 ? `Constraints: ${constraints.join("; ")}` : "",
    "Writing sample:",
    sampleText,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface DeviationPromptOptions {
  includeRawText: boolean;
}

export function buildDeviationPrompt(
  profile: unknown,
  targetText: string,
  opts: DeviationPromptOptions = { includeRawText: false },
): string {
  if (!opts.includeRawText) {
    throw new Error(
      "buildDeviationPrompt requires includeRawText: true — raw document text must not leave the add-in without explicit user opt-in",
    );
  }
  return [
    "Given this style profile (JSON):",
    JSON.stringify(profile),
    "Identify semantic deviations in the target text.",
    "Return a JSON array of objects with keys: deviation (string), severity (low|medium|high),",
    "suggestion (string). No explanation outside the JSON.",
    "Target text:",
    targetText,
  ].join("\n");
}
