/**
 * The extraction prompt (original §7).
 *
 * The General LLM structures the report in two passes; this is
 * the Pass A prompt. It is strict: the model must return the
 * extraction schema and nothing else, and it must follow the
 * ten prompt rules. ToneForge owns identity and evidence
 * provenance — the model never assigns ids, offsets, or hashes;
 * it quotes, and ToneForge locates the quote in the document.
 *
 * Like every prompt builder in the add-in, the builder is
 * gated: raw document text must not leave the add-in without
 * the run's explicit opt-out (D13), so the check is the first
 * statement and it throws before a prompt string exists.
 */

import { z } from "zod";
import {
  AdoptionStatusSchema,
  AssertionStrengthSchema,
  ClaimClassSchema,
  ClaimModalitySchema,
  ClaimScopeSchema,
  ClaimValueSchema,
  CausationContextSchema,
  ContractualBasisSchema,
  DelayContextSchema,
  PartyRefSchema,
  QualifierSchema,
  QuantumContextSchema,
  ResponsibilityContextSchema,
  ScenarioContextSchema,
  TemporalContextSchema,
} from "../contracts";
import type { ExtractionBatch } from "./batch";

export interface ExtractionPromptOptions {
  includeRawText: boolean;
}

/**
 * The evidence the model quotes: the paragraph a claim comes
 * from and the exact text of the claim within it. The model
 * cannot know character offsets or hashes, so it quotes and
 * ToneForge resolves the quote to a proven anchor.
 */
export const RawEvidenceSchema = z.object({
  paragraphId: z.string().trim().min(1),
  exactText: z.string().trim().min(1),
});

export type RawEvidence = z.infer<typeof RawEvidenceSchema>;

/**
 * One claim as the model returns it.
 *
 * This is the claim schema minus what ToneForge owns: no `id`,
 * no `reviewSessionId`, no `extraction` metadata, and evidence
 * as a quote rather than a resolved anchor. Every facet is
 * optional, because a facet the document does not settle is
 * unknown — the model is told to omit it rather than guess.
 */
export const RawExtractedClaimSchema = z.object({
  claimClass: ClaimClassSchema,
  predicate: z.string().trim().min(1),
  speaker: PartyRefSchema,
  attributedTo: PartyRefSchema.optional(),
  adoptionStatus: AdoptionStatusSchema.optional(),
  polarity: z.enum(["positive", "negative"]),
  subjectIds: z.array(z.string().trim()).optional(),
  objectIds: z.array(z.string().trim()).optional(),
  workItemIds: z.array(z.string().trim()).optional(),
  eventIds: z.array(z.string().trim()).optional(),
  programmeIds: z.array(z.string().trim()).optional(),
  documentRefIds: z.array(z.string().trim()).optional(),
  temporal: TemporalContextSchema.optional(),
  values: z.array(ClaimValueSchema).optional(),
  scope: ClaimScopeSchema.optional(),
  delay: DelayContextSchema.optional(),
  quantum: QuantumContextSchema.optional(),
  causation: CausationContextSchema.optional(),
  responsibility: ResponsibilityContextSchema.optional(),
  contractualBasis: z.array(ContractualBasisSchema).optional(),
  modality: ClaimModalitySchema.optional(),
  qualifiers: z.array(QualifierSchema).optional(),
  assertionStrength: AssertionStrengthSchema.optional(),
  scenario: ScenarioContextSchema.optional(),
  evidence: RawEvidenceSchema,
});

export type RawExtractedClaim = z.infer<typeof RawExtractedClaimSchema>;

/** The strict response shape: claims, and nothing else. */
export const ExtractionResponseSchema = z.object({
  claims: z.array(RawExtractedClaimSchema),
});

export type ExtractionResponse = z.infer<typeof ExtractionResponseSchema>;

/**
 * The ten prompt rules (original §7), as instructions. They are
 * the extraction contract: atomic propositions, exact
 * attribution, expert-versus-reported separation, scenario
 * separation, modality, programme revision and data date,
 * delay and quantum basis, exact evidence, unknown rather than
 * guessing, and no unsupported facts.
 */
const PROMPT_RULES = [
  "1. State one atomic proposition per claim: no compound sentences, no two facts in one claim.",
  "2. Attribute every claim exactly: name the party the text names as the source, and the party it is attributed to when they differ.",
  "3. Separate the expert's own opinions and conclusions from reported party positions and quoted sources.",
  "4. Keep scenarios separate: a figure stated under one scenario is never merged with the same figure under another.",
  "5. Mark the modality of every claim: actual, forecast, assumption, or conclusion.",
  "6. Record the programme revision and the data date wherever a figure is dated.",
  "7. Record the basis of every delay and every quantum figure.",
  "8. Quote the exact evidence for every claim, and name the paragraph it comes from.",
  "9. Leave a facet unknown rather than guessing at it.",
  "10. Assert no fact the text does not support.",
] as const;

/**
 * Build the Pass A extraction prompt for one batch.
 *
 * The prompt carries the section hierarchy, the stable
 * paragraph ids, the paragraph text, and the strict response
 * schema. The model is told the enum vocabularies so it cannot
 * invent values, and told that ToneForge assigns ids, offsets,
 * and hashes after validation.
 */
export function buildExtractionPrompt(
  batch: ExtractionBatch,
  opts: ExtractionPromptOptions = { includeRawText: false },
): string {
  if (!opts.includeRawText) {
    throw new Error(
      "buildExtractionPrompt requires includeRawText: true — raw document text must not leave the add-in without explicit user opt-in",
    );
  }
  const hierarchy = batch.paragraphs
    .map((paragraph) => `[${paragraph.paragraphId}] ${paragraph.text}`)
    .join("\n");
  return [
    "You are extracting structured claims from one section of a construction expert report.",
    "",
    `Section: ${batch.sectionTitle || "(opening text)"}`,
    `Section path: ${batch.sectionPath.join(" > ") || "(root)"}`,
    "",
    "Follow these ten rules exactly:",
    ...PROMPT_RULES,
    "",
    'Return a JSON object with exactly one key, "claims", whose value is an array of',
    "claim objects. Each claim object may have only these keys:",
    `- claimClass (required): one of ${ClaimClassSchema.options.join(", ")}`,
    "- predicate (required): the claim as one atomic proposition, a string",
    "- speaker (required): { id, name, role? } — the party the text names as the source",
    "- attributedTo (optional): { id, name, role? } — the party the claim is about, when different from the speaker",
    `- adoptionStatus (optional): one of ${AdoptionStatusSchema.options.join(", ")} — omit when undetermined`,
    '- polarity (required): "positive" or "negative"',
    "- subjectIds, objectIds, workItemIds, eventIds, programmeIds, documentRefIds (optional): arrays of strings — omit when there are none",
    "- temporal, values, scope, delay, quantum, causation, responsibility, contractualBasis, modality, qualifiers, assertionStrength, scenario (optional): the structured facets — omit when the text does not settle them",
    "- evidence (required): { paragraphId, exactText } — the paragraph the claim comes from and the exact quoted text",
    "",
    "Do not invent ids, offsets, or hashes: ToneForge assigns them after validation.",
    "Return the JSON object and nothing else — no prose before or after it.",
    "",
    "Section text:",
    hierarchy,
  ].join("\n");
}
