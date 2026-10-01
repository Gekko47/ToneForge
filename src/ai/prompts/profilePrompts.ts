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
 *
 * `anchor` is required, not optional. A deviation described without a verbatim
 * quote has no addressable target, and a finding with no addressable target
 * cannot be planned — so an entry that omits it describes nothing the product
 * could act on. Requiring it moves the burden onto the model at the point where
 * it can still read the text it is quoting.
 */
export const DeviationResponseSchema = z.object({
  deviation: z.string().trim().min(1),
  severity: z.enum(["low", "medium", "high"]),
  suggestion: z.string().trim().min(1),
  /** A verbatim substring of the target text that this deviation is about. */
  anchor: z.string().trim().min(1),
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

/**
 * The V2 learning prompt.
 *
 * Same raw-text gate as every other builder — the check is the first statement
 * and it throws before a prompt string exists, so no caller can accidentally
 * build a prompt containing a document and then not send it.
 *
 * Two things the V1 prompt did not say, and both are load-bearing:
 *
 * - **Every group is named, and the model is told not to omit one.** The
 *   response is validated against a schema with no defaults, so a group the model
 *   forgets is a refusal rather than a silent "tone: neutral". Telling the model
 *   the rule is cheaper than telling the user their provider failed.
 * - **The description fields are told not to quote the sample.** They are where
 *   a project name, a date, or a figure lands when a model paraphrases instead of
 *   describing, and the leakage check will refuse the whole analysis if one
 *   arrives. Better to be explicit at the source and still verify afterwards.
 */
export function buildProfilePromptV2(
  sampleText: string,
  constraints: string[] = [],
  opts: ProfilePromptOptions = { includeRawText: false },
): string {
  if (!opts.includeRawText) {
    throw new Error(
      "buildProfilePromptV2 requires includeRawText: true — raw document text must not leave the add-in without explicit user opt-in",
    );
  }
  return [
    "Analyze the following writing sample and describe how it reads.",
    "Return a JSON object and nothing else. Every one of these sixteen keys must be",
    "present, and every key inside them must be present:",
    "tone (primary, secondary, description), voice (person, construction, authorialPresence, description),",
    "formality (score, label), register (primary, description),",
    "assertionStyle (strength, ordering, directness), qualificationStyle (frequency, strength, exceptions, conditionals),",
    "evidenceFraming (recordFirst, attribution, quotation, explicitReferences, progression),",
    "uncertaintyStyle (incompleteEvidence, confidenceLanguage, modality, avoidsUnsupportedCertainty),",
    "sentenceArchitecture (complexity, clauseDensity, targetWords, coordination, shortClosingSentence),",
    "paragraphArchitecture (function, ordering, targetWords, propositions), transitions,",
    "agency (actorNaming, passiveTendency, attributionPrecision),",
    "technicality (density, explainsTerms, abbreviationTendency), rhetoricalStyle,",
    "conclusionStyle (form, avoidsRepetition),",
    "lexicalPreferences (toneAvoid, prefersNeutralVerbs, evaluativeLanguage).",
    "",
    "Describe the writing, not its subject. A description must not name a project, a",
    "company, a person, a date, an amount, or any other fact from the sample — a style",
    "profile that carries the document's content into the editor is a leak, and one that",
    "cannot be checked is useless. Use an empty string when a description would help but",
    "you have nothing safe to say.",
    "Choose the enum values that fit; do not invent new ones. If the sample does not",
    "settle a dimension, give the most likely value rather than omitting the key.",
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
    "suggestion (string), anchor (string). No explanation outside the JSON.",
    // Stated as a rule rather than left to inference, because a model that
    // paraphrases its anchor produces a finding that has to be thrown away, and
    // the user sees a deviation listed with no way to act on it.
    "The anchor must be copied character for character from the target text, and must",
    "identify a short span that appears exactly once. Quote a single sentence or clause,",
    "not a whole paragraph. A deviation you cannot quote is one you should not report.",
    "Target text:",
    targetText,
  ].join("\n");
}
