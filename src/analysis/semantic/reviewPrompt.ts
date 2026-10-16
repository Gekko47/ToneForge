/**
 * The Semantic Review prompt.
 *
 * **The consent gate is the first statement and it throws before a prompt string
 * exists.** No caller can build a prompt containing a selection and then decide
 * not to send it, and no caller can reach the provider directly from the engine
 * and skip this — the engine's only route to the network is through a builder
 * that refuses.
 *
 * Three instructions in here are doing real work, and each was written because
 * the alternative was observed:
 *
 * - **The revision must replace the whole selection.** The engine refuses a
 *   mismatch, but a prompt that does not say so produces one every few calls.
 * - **Copy the selection into `original` character for character.** The engine
 *   compares, so a paraphrase is a refusal — and the user sees "the model
 *   described the selection slightly differently" rather than a revision.
 * - **Report the five meaning flags honestly.** A model told to be cautious
 *   reports `false` on everything, which disables Apply for every paragraph; a
 *   model told nothing reports `true` on everything, which is the claim the local
 *   validator cannot check. The wording asks for the flags the revision
 *   actually bears in mind and tells it that the local checks run anyway, so it
 *   has no reason to over-report to look careful.
 */

import type { SemanticReviewRequest } from "./contracts";

/** Prompt version. Bump whenever the output contract changes. */
export const PROMPT_VERSION = 1;

/**
 * Appended to the prompt for one repair attempt after an unreadable answer.
 *
 * A second call rather than a re-ask of the same one, because a provider here
 * holds no memory of the first response and an instruction that assumed one
 * would be addressed to nobody. It restates the expectation without restating
 * the schema, which the original prompt above it still carries.
 */
export const REPAIR_INSTRUCTION =
  "\n\nYour previous answer to this request could not be read. Respond with ONLY a single" +
  " valid JSON object matching the schema above, with no markdown, no code fences and no" +
  " other text.";

export interface SemanticReviewPromptOptions {
  /** Explicit consent to send the selection to the provider. */
  includeRawText: boolean;
}

const DOMAIN_FRAMING: Readonly<Record<SemanticReviewRequest["domain"], string>> = {
  general:
    "The profile was learned from general business writing. Judge the selection against it, " +
    "not against any convention about technical prose.",
  constructionExpert:
    "The profile was learned from expert construction and engineering reporting. In that " +
    "register an explicit causal claim, a named party, a reference, and a figure are the " +
    "substance of a paragraph rather than decoration, and removing a hedge can reverse what " +
    "the paragraph claims even when every fact is untouched.",
};

/**
 * The sixteen semantic dimensions, in the order the editor groups them.
 * Exported so the prompt and the schema agree on the set.
 */
export const SEMANTIC_DIMENSIONS_LIST = [
  "tone",
  "voice",
  "formality",
  "register",
  "assertionStyle",
  "qualificationStyle",
  "evidenceFraming",
  "uncertaintyStyle",
  "sentenceArchitecture",
  "paragraphArchitecture",
  "transitions",
  "agency",
  "technicality",
  "rhetoricalStyle",
  "conclusionStyle",
  "lexicalPreferences",
] as const;

/**
 * The allowed values for each dimension's enum fields, so the model can choose
 * from the list rather than inventing values that fail schema validation.
 */
const DIMENSION_ENUMS = [
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
].join("\n");

export function buildSemanticReviewPrompt(
  request: SemanticReviewRequest,
  opts: SemanticReviewPromptOptions = { includeRawText: false },
): string {
  if (!opts.includeRawText) {
    throw new Error(
      "buildSemanticReviewPrompt requires includeRawText: true — raw document text must not leave the add-in without explicit user opt-in",
    );
  }

  return [
    `<!-- prompt-version: ${PROMPT_VERSION} -->`,
    "Review the selection below against the active style profile, and propose a restyle if one is warranted.",
    DOMAIN_FRAMING[request.domain],
    "",
    "Return a single JSON object and nothing else. No markdown, no code fences, no commentary before or after.",
    "Do not include any keys other than those listed. Do not include null values for required fields.",
    "",
    "The JSON object must have exactly these keys:",
    "assessment (overallAlignment: high|moderate|low, summary: string,",
    "observations: an array of {dimension, alignment, explanation, evidenceQuote?}),",
    "proposedRevision (optional; omit it entirely if the selection already matches),",
    "meaningPreservation (qualificationPreserved, attributionPreserved, causationPreserved,",
    "responsibilityPreserved, certaintyPreserved — five booleans),",
    "rationale (one sentence on what you changed and why).",
    "",
    "The 'dimension' field must be one of: tone, voice, formality, register, assertionStyle, qualificationStyle, evidenceFraming, uncertaintyStyle, sentenceArchitecture, paragraphArchitecture, transitions, agency, technicality, rhetoricalStyle, conclusionStyle, lexicalPreferences.",
    "The 'alignment' field must be one of: aligned, minor_deviation, material_deviation.",
    "The 'overallAlignment' field must be one of: high, moderate, low.",
    "",
    "For proposedRevision, copy original from the selection character for character and put the",
    "restyled text in revised. The revision replaces that exact span and nothing else. If you",
    "cannot reproduce the selection exactly, return no proposedRevision.",
    "",
    "Keep every number, date, amount, reference and named party exactly as written. Numbers and",
    "dates are checked locally and a change to either is refused before you are asked about it.",
    "",
    "Set the five meaning flags to what your revision actually does. Report a false only where",
    "you are not certain the claim, the attribution, the causation, the responsibility or the",
    "degree of certainty survived. They are checked alongside local checks, not instead of them,",
    "so over-reporting does not make the revision safer.",
    "",
    "Allowed values for each dimension's enum fields:",
    DIMENSION_ENUMS,
    "",
    "Active style profile (JSON):",
    JSON.stringify(request.semantic),
    "",
    "Selection to review:",
    request.selectedText,
  ].join("\n");
}
