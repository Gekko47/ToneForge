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
