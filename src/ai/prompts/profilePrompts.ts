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

/*
 * The deviation prompt and its response schema are gone.
 *
 * They described a list of independent complaints with quoted anchors, which is
 * the shape the deterministic findings list already uses — and putting a model's
 * stylistic opinion in that shape is what made "the model thought this sentence
 * was odd" indistinguishable from "this paragraph uses the wrong quote marks".
 * `SemanticReviewResponseSchema` in `src/analysis/semantic/reviewSchema.ts`
 * replaces them with an assessment and at most one proposal.
 */

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
 * The allowed values for every enum field in the V2 extraction schema.
 *
 * The model needs to know the options to choose from — without them it will
 * invent values that fail schema validation, producing a refusal rather than
 * a profile. This is the complete list from `SemanticStyleProfile.ts`.
 */
const ENUM_OPTIONS = [
  "Allowed values for each field — choose exactly one unless noted:",
  "",
  'tone.primary: "restrained" | "neutral" | "assertive" | "cautious" | "analytical" | "forensic" | "explanatory" | "persuasive"',
  "tone.secondary: array of at most 2 from the same list",
  'voice.person: "first" | "third" | "mixed" | "impersonal"',
  'voice.construction: "active" | "passive" | "balanced"',
  'voice.authorialPresence: "absent" | "restrained" | "explicit"',
  "formality.score: integer 0-100",
  'register.primary: "plain" | "professional" | "technical" | "expert" | "academic" | "legal-technical"',
  'assertionStyle.strength: "categorical" | "qualified" | "conditional" | "provisional"',
  'assertionStyle.ordering: "evidence-first" | "conclusion-first" | "interleaved"',
  'assertionStyle.directness: "direct" | "measured" | "indirect"',
  'qualificationStyle.frequency: "rare" | "occasional" | "frequent"',
  'qualificationStyle.strength: "light" | "moderate" | "heavy"',
  'qualificationStyle.exceptions: "none" | "inline" | "dedicated"',
  'evidenceFraming.attribution: "none" | "occasional" | "systematic"',
  'evidenceFraming.quotation: "rare" | "selective" | "frequent"',
  'evidenceFraming.progression: "source-analysis-conclusion" | "claim-evidence" | "narrative"',
  'uncertaintyStyle.incompleteEvidence: "stated" | "implied" | "suppressed"',
  'uncertaintyStyle.confidenceLanguage: "explicit" | "implicit" | "absent"',
  'uncertaintyStyle.modality: "frequent" | "occasional" | "rare"',
  'sentenceArchitecture.complexity: "simple" | "moderate" | "complex"',
  'sentenceArchitecture.clauseDensity: "low" | "medium" | "high"',
  "sentenceArchitecture.targetWords: integer 5-60",
  'sentenceArchitecture.coordination: "coordination" | "subordination" | "mixed"',
  'paragraphArchitecture.function: "topic" | "evidence" | "analysis" | "conclusion" | "mixed"',
  'paragraphArchitecture.ordering: "topic-evidence-conclusion" | "conclusion-evidence" | "chronological" | "comparative"',
  "paragraphArchitecture.targetWords: integer 20-400",
  'paragraphArchitecture.propositions: "single" | "multiple"',
  'transitions: "restrained" | "explicit" | "rhetorical"',
  'agency.actorNaming: "named" | "role" | "impersonal" | "mixed"',
  'agency.passiveTendency: "low" | "medium" | "high"',
  'agency.attributionPrecision: "exact" | "general" | "unspecified"',
  'technicality.density: "low" | "medium" | "high"',
  'technicality.abbreviationTendency: "none" | "first-use" | "permissive"',
  'rhetoricalStyle: "direct-analytical" | "narrative" | "forensic" | "comparative" | "argumentative" | "explanatory"',
  'conclusionStyle.form: "concise" | "qualified" | "recap" | "opinion" | "none"',
  'lexicalPreferences.evaluativeLanguage: "none" | "restrained" | "explicit"',
  "",
  "Boolean fields (true or false): evidenceFraming.recordFirst, evidenceFraming.explicitReferences,",
  "uncertaintyStyle.avoidsUnsupportedCertainty, sentenceArchitecture.shortClosingSentence,",
  "technicality.explainsTerms, conclusionStyle.avoidsRepetition, qualificationStyle.conditionals,",
  "lexicalPreferences.prefersNeutralVerbs.",
  "String array fields: tone.secondary, lexicalPreferences.toneAvoid.",
  "Free-text fields: tone.description, voice.description, register.description, formality.label.",
].join("\n");

/**
 * The response as literal JSON.
 *
 * **Why a skeleton, and not the key list it replaced.** A list of key names is a
 * shape a model is free to interpret: asked for `tone (primary, secondary,
 * description)`, a small model answers with the string `"restrained, analytical"`
 * where an object was required, and the strict extraction schema refuses the whole
 * analysis over a nesting mistake. The skeleton states the nesting, the
 * delimiters, and the type of every value — the part a key list cannot state. The
 * review prompt reached the same conclusion when its prose key list became a
 * literal skeleton.
 *
 * `<allowed>` is a placeholder for one of the values listed for that field, and
 * `<true or false>` for a boolean. Neither is meant to be echoed.
 */
const RESPONSE_SKELETON = [
  "Return exactly this JSON object, with every key present and no prose around it:",
  "{",
  '  "tone": { "primary": "<allowed>", "secondary": [<up to 2 allowed values>], "description": "<one sentence, or an empty string>" },',
  '  "voice": { "person": "<allowed>", "construction": "<allowed>", "authorialPresence": "<allowed>", "description": "<one sentence, or an empty string>" },',
  '  "formality": { "score": <integer 0-100>, "label": "<short label>" },',
  '  "register": { "primary": "<allowed>", "description": "<one sentence, or an empty string>" },',
  '  "assertionStyle": { "strength": "<allowed>", "ordering": "<allowed>", "directness": "<allowed>" },',
  '  "qualificationStyle": { "frequency": "<allowed>", "strength": "<allowed>", "exceptions": "<allowed>", "conditionals": <true or false> },',
  '  "evidenceFraming": { "recordFirst": <true or false>, "attribution": "<allowed>", "quotation": "<allowed>", "explicitReferences": <true or false>, "progression": "<allowed>" },',
  '  "uncertaintyStyle": { "incompleteEvidence": "<allowed>", "confidenceLanguage": "<allowed>", "modality": "<allowed>", "avoidsUnsupportedCertainty": <true or false> },',
  '  "sentenceArchitecture": { "complexity": "<allowed>", "clauseDensity": "<allowed>", "targetWords": <integer 5-60>, "coordination": "<allowed>", "shortClosingSentence": <true or false> },',
  '  "paragraphArchitecture": { "function": "<allowed>", "ordering": "<allowed>", "targetWords": <integer 20-400>, "propositions": "<allowed>" },',
  '  "transitions": "<allowed>",',
  '  "agency": { "actorNaming": "<allowed>", "passiveTendency": "<allowed>", "attributionPrecision": "<allowed>" },',
  '  "technicality": { "density": "<allowed>", "explainsTerms": <true or false>, "abbreviationTendency": "<allowed>" },',
  '  "rhetoricalStyle": "<allowed>",',
  '  "conclusionStyle": { "form": "<allowed>", "avoidsRepetition": <true or false> },',
  '  "lexicalPreferences": { "toneAvoid": [<strings>], "prefersNeutralVerbs": <true or false>, "evaluativeLanguage": "<allowed>" }',
  "}",
  "",
  "The type of each value matters as much as the value:",
  "- each of the sixteen keys is a JSON object, except transitions and rhetoricalStyle, which are bare strings",
  "- every boolean field is JSON true or false, unquoted, never the word 'true' or 'yes'",
  "- every enumerated field takes one of the values listed for it below, spelled exactly as written there",
  "- secondary and toneAvoid are JSON arrays of strings, never one comma-separated string",
  "- <allowed> marks a field that takes one of the values listed below",
].join("\n");

/**
 * The V2 learning prompt.
 *
 * Same raw-text gate as every other builder — the check is the first statement
 * and it throws before a prompt string exists, so no caller can accidentally
 * build a prompt containing a document and then not send it.
 *
 * Three things the V1 prompt did not say, and all three are load-bearing:
 *
 * - **Every group is named, and the model is told not to omit one.** The
 *   response is validated against a schema with no defaults, so a group the model
 *   forgets is a refusal rather than a silent "tone: neutral". Telling the model
 *   the rule is cheaper than telling the user their provider failed.
 * - **The shape is shown, not listed.** `RESPONSE_SKELETON` states the nesting,
 *   the delimiters and the type of every value; a list of key names leaves all
 *   three to inference, which is how a model answers a group with a string where
 *   an object was required and loses the analysis over the nesting rather than
 *   the reading.
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
    "present, and every key inside them must be present.",
    "",
    RESPONSE_SKELETON,
    "",
    ENUM_OPTIONS,
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
