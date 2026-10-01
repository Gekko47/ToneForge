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
    "Review the selection below against the active style profile, and propose a restyle if one is warranted.",
    DOMAIN_FRAMING[request.domain],
    "",
    "Return a JSON object and nothing else, with exactly these keys:",
    "assessment (overallAlignment: high|moderate|low, summary: string,",
    "observations: an array of {dimension, alignment, explanation, evidenceQuote?}),",
    "proposedRevision (optional; omit it entirely if the selection already matches),",
    "meaningPreservation (qualificationPreserved, attributionPreserved, causationPreserved,",
    "responsibilityPreserved, certaintyPreserved — five booleans),",
    "rationale (one sentence on what you changed and why).",
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
    "Active style profile (JSON):",
    JSON.stringify(request.semantic),
    "",
    "Selection to review:",
    request.selectedText,
  ].join("\n");
}
