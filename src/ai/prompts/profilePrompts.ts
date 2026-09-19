/**
 * Prompt builders for semantic style profiling.
 * Prompts are redacted before sending: no document text leaves the add-in
 * unless the user explicitly opts in.
 */

export interface ProfilePromptOptions {
  includeRawText: boolean;
}

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
