import { z } from "zod";
import { EvidenceAnchorSchema } from "./evidence";

/**
 * The full claim schema (D1, original §5).
 *
 * Every fact the extraction pass asserts about the document is one of
 * these. The schema is deliberately wide: a claim the engine cannot
 * classify is a claim it cannot compare, and an unclassifiable claim
 * silently dropped is a false negative the report would never mention.
 * Unknown stays unknown, and unknown is counted — never forced into a
 * facet the document does not support.
 *
 * The class, adoption, and scenario vocabularies are the construction-
 * domain vocabularies from the original §5 and §6, verbatim. The one
 * addition is `"unknown"` on `AdoptionStatusSchema`: the original lists
 * ten distinguished adoption states with no undetermined state, but the
 * engine's standing rule is that unknown stays unknown, so an
 * undetermined adoption is representable rather than a parse failure.
 */

/** What kind of fact this claim asserts (original §5 claim classes). */
export const ClaimClassSchema = z.enum([
  "FACT_ASSERTION",
  "REPORTED_FACT",
  "PARTY_POSITION",
  "EXPERT_OPINION",
  "EXPERT_CONCLUSION",
  "ASSUMPTION",
  "CALCULATION",
  "FORECAST",
  "PROGRAMME_POSITION",
  "CONTRACTUAL_REQUIREMENT",
  "ENTITLEMENT_POSITION",
  "CAUSATION_POSITION",
  "RESPONSIBILITY_POSITION",
  "VALUATION_POSITION",
  "MEASUREMENT",
  "QUOTATION",
  "SCENARIO",
  "QUALIFICATION",
  "REFERENCE",
]);

export type ClaimClass = z.infer<typeof ClaimClassSchema>;

/**
 * How the document holds this claim (original §5 adoption states).
 *
 * A reported party position is not the expert's adopted opinion: the
 * `reported_party_position` and `quoted_source` states exist so a
 * position the expert merely records is never compared as though the
 * expert asserted it.
 */
export const AdoptionStatusSchema = z.enum([
  "author_opinion",
  "author_conclusion",
  "author_assumption",
  "author_calculation",
  "reported_party_position",
  "quoted_source",
  "contractual_requirement",
  "contemporaneous_record",
  "hypothetical",
  "alternative_scenario",
  "unknown",
]);

export type AdoptionStatus = z.infer<typeof AdoptionStatusSchema>;

/** A reference to a party: who said, owns, or is bound by a claim. */
export const PartyRefSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  role: z.string().trim().optional(),
});

export type PartyRef = z.infer<typeof PartyRefSchema>;

/** The canonical form of what the claim asserts. */
export const CanonicalPredicateSchema = z.object({
  text: z.string().trim().min(1),
  kind: z.string().trim().optional(),
});

export type CanonicalPredicate = z.infer<typeof CanonicalPredicateSchema>;

/** One date as the document gave it, plus whatever was parsed from it. */
export const DateValueSchema = z.object({
  raw: z.string().trim().min(1),
  iso: z.string().trim().optional(),
  year: z.number().int().optional(),
  month: z.number().int().min(0).max(12).optional(),
  day: z.number().int().min(0).max(31).optional(),
  /** True when the source gave only a coarse date (month, year). */
  coarse: z.boolean().default(false),
});

export type DateValue = z.infer<typeof DateValueSchema>;

/**
 * The temporal context (original §6 Temporal).
 *
 * Assertion, event, effective, reporting, data, forecast and baseline
 * dates are kept separately: a date that is one of these is not
 * interchangeable with another, and collapsing them is how a
 * forecast-vs-actual contradiction hides.
 */
export const TemporalContextSchema = z.object({
  assertionDate: DateValueSchema.optional(),
  eventDate: DateValueSchema.optional(),
  effectiveDate: DateValueSchema.optional(),
  reportingDate: DateValueSchema.optional(),
  dataDate: DateValueSchema.optional(),
  forecastDate: DateValueSchema.optional(),
  baselineDate: DateValueSchema.optional(),
  periodStart: DateValueSchema.optional(),
  periodEnd: DateValueSchema.optional(),
  dateType: z.string().trim().optional(),
});

export type TemporalContext = z.infer<typeof TemporalContextSchema>;

/** The kind of programme a claim is measured against (original §6). */
export const ProgrammeTypeSchema = z.enum([
  "baseline",
  "accepted_baseline",
  "updated",
  "revised",
  "recovery",
  "as_built",
  "fragnet",
  "analysis_model",
  "unknown",
]);

export type ProgrammeType = z.infer<typeof ProgrammeTypeSchema>;

/**
 * The programme context (original §6 Programme).
 *
 * A first-class programme: its type, identity, title, revision, status
 * date, data date, and source. A delay measured against a baseline is
 * not comparable to the same delay measured against a recovery
 * programme, and the type is what makes that visible.
 */
export const ProgrammeContextSchema = z.object({
  type: ProgrammeTypeSchema,
  identifier: z.string().trim().optional(),
  title: z.string().trim().optional(),
  revision: z.string().trim().optional(),
  statusDate: DateValueSchema.optional(),
  dataDate: DateValueSchema.optional(),
  source: z.string().trim().optional(),
});

export type ProgrammeContext = z.infer<typeof ProgrammeContextSchema>;

/**
 * The delay context (original §6 Delay).
 *
 * Criticality, excusability, compensability, concurrency,
 * prolongation/disruption, duration and its basis, analysis method,
 * critical path, affected activities, cause/effect, programme basis,
 * analysis window, float, and completion impact. Every facet is
 * optional: a delay claim that says only "six weeks" is a delay claim,
 * and the facets it does not carry stay unknown.
 */
export const DelayContextSchema = z.object({
  criticality: z.string().trim().optional(),
  excusability: z.string().trim().optional(),
  compensability: z.string().trim().optional(),
  concurrency: z.string().trim().optional(),
  prolongation: z.string().trim().optional(),
  disruption: z.string().trim().optional(),
  durationText: z.string().trim().optional(),
  durationDays: z.number().optional(),
  durationBasis: z.string().trim().optional(),
  analysisMethod: z.string().trim().optional(),
  criticalPath: z.string().trim().optional(),
  affectedActivities: z.array(z.string().trim()).default([]),
  cause: z.string().trim().optional(),
  effect: z.string().trim().optional(),
  programmeBasis: z.string().trim().optional(),
  analysisWindow: z
    .object({
      start: DateValueSchema.optional(),
      end: DateValueSchema.optional(),
    })
    .optional(),
  floatDays: z.number().optional(),
  completionImpact: z.string().trim().optional(),
});

export type DelayContext = z.infer<typeof DelayContextSchema>;

/** Whether a quantum is stated in nominal or real terms. */
export const QuantumBasisSchema = z.enum(["nominal", "real", "unknown"]);

export type QuantumBasis = z.infer<typeof QuantumBasisSchema>;

/**
 * The quantum context (original §6 Quantum).
 *
 * Head/cost type, amount and currency, base date, nominal/real basis,
 * escalation, valuation period, quantity and unit, rate, valuation
 * method, gross/net, tax, overhead, profit, and the calculation
 * sources. A figure without its basis is not comparable to one with it.
 */
export const QuantumContextSchema = z.object({
  headType: z.string().trim().optional(),
  costType: z.string().trim().optional(),
  amount: z.number().optional(),
  currency: z.string().trim().optional(),
  baseDate: DateValueSchema.optional(),
  basis: QuantumBasisSchema.default("unknown"),
  escalation: z.string().trim().optional(),
  valuationPeriod: z
    .object({
      start: DateValueSchema.optional(),
      end: DateValueSchema.optional(),
    })
    .optional(),
  quantity: z.number().optional(),
  unit: z.string().trim().optional(),
  rate: z.number().optional(),
  valuationMethod: z.string().trim().optional(),
  gross: z.number().optional(),
  net: z.number().optional(),
  tax: z.number().optional(),
  overhead: z.number().optional(),
  profit: z.number().optional(),
  calculationSources: z.array(z.string().trim()).default([]),
});

export type QuantumContext = z.infer<typeof QuantumContextSchema>;

/** The causation context: the causal link the claim asserts. */
export const CausationContextSchema = z.object({
  assertedCause: z.string().trim().optional(),
  assertedEffect: z.string().trim().optional(),
  basis: z.string().trim().optional(),
});

export type CausationContext = z.infer<typeof CausationContextSchema>;

/** The responsibility context: who bears the consequence. */
export const ResponsibilityContextSchema = z.object({
  party: PartyRefSchema.optional(),
  allocation: z.string().trim().optional(),
  basis: z.string().trim().optional(),
});

export type ResponsibilityContext = z.infer<typeof ResponsibilityContextSchema>;

/** A contractual provision a claim rests on. */
export const ContractualBasisSchema = z.object({
  reference: z.string().trim().min(1),
  clause: z.string().trim().optional(),
  text: z.string().trim().optional(),
});

export type ContractualBasis = z.infer<typeof ContractualBasisSchema>;

/** A citation from a claim to a registered evidence anchor. */
export const EvidenceBasisSchema = z.object({
  anchorId: z.string().trim().min(1),
  role: z.string().trim().optional(),
});

export type EvidenceBasis = z.infer<typeof EvidenceBasisSchema>;

/** A value the claim asserts, as written and as normalised. */
export const ClaimValueSchema = z.object({
  raw: z.string().trim().min(1),
  normalized: z.number().optional(),
  unit: z.string().trim().optional(),
  currency: z.string().trim().optional(),
});

export type ClaimValue = z.infer<typeof ClaimValueSchema>;

/** How wide a claim reaches (C10 scope: universal versus exception). */
export const ClaimScopeKindSchema = z.enum(["universal", "exception", "qualified", "unknown"]);

export type ClaimScopeKind = z.infer<typeof ClaimScopeKindSchema>;

/** The scope of a claim: what it applies to, and how widely. */
export const ClaimScopeSchema = z.object({
  kind: ClaimScopeKindSchema,
  description: z.string().trim().optional(),
});

export type ClaimScope = z.infer<typeof ClaimScopeSchema>;

/** The modality of a claim: what kind of speech act it is. */
export const ClaimModalitySchema = z.enum([
  "assertion",
  "obligation",
  "permission",
  "prohibition",
  "forecast",
  "hypothetical",
  "unknown",
]);

export type ClaimModality = z.infer<typeof ClaimModalitySchema>;

/** A qualifier on a claim: "approximately", "subject to", "excluding". */
export const QualifierSchema = z.object({
  text: z.string().trim().min(1),
  kind: z.string().trim().optional(),
});

export type Qualifier = z.infer<typeof QualifierSchema>;

/** How strongly the claim is asserted. */
export const AssertionStrengthSchema = z.enum(["definitive", "qualified", "tentative", "unknown"]);

export type AssertionStrength = z.infer<typeof AssertionStrengthSchema>;

/** The kind of scenario a claim is stated under (original §6 Scenario). */
export const ScenarioTypeSchema = z.enum([
  "primary",
  "alternative",
  "sensitivity",
  "counterfactual",
  "party_case",
  "tribunal_assumption",
  "other",
]);

export type ScenarioType = z.infer<typeof ScenarioTypeSchema>;

/**
 * The scenario context (original §6 Scenario).
 *
 * Different explicit scenarios normally terminate direct inconsistency
 * comparison: a figure in the primary scenario is not in conflict with
 * the same figure in a party's alternative case, and the scenario type
 * is what keeps them apart.
 */
export const ScenarioContextSchema = z.object({
  type: ScenarioTypeSchema,
  description: z.string().trim().optional(),
  owner: PartyRefSchema.optional(),
});

export type ScenarioContext = z.infer<typeof ScenarioContextSchema>;

/** Which extraction pass produced the claim (original §7). */
export const ExtractionPassSchema = z.enum(["local", "global"]);

export type ExtractionPass = z.infer<typeof ExtractionPassSchema>;

/**
 * Provenance for the claim: which model, which pass, which batch, when.
 * Every claim carries this, so a claim in the report can always be
 * traced back to the extraction that produced it.
 */
export const ExtractionMetadataSchema = z.object({
  modelId: z.string().trim().min(1),
  pass: ExtractionPassSchema,
  batchId: z.string().trim().min(1),
  extractedAt: z.string().trim().min(1),
});

export type ExtractionMetadata = z.infer<typeof ExtractionMetadataSchema>;

/**
 * One structured claim (original §5 ExpertReportClaim).
 *
 * `id` is the canonical identifier, assigned by the evidence validator
 * after the claim's evidence resolves — a claim whose evidence is
 * unresolved is quarantined and never receives a canonical id.
 * `evidence` is the primary anchor: every claim has provenance, or it
 * is not a claim the engine will compare.
 *
 * The identity fields (`id`, `reviewSessionId`, `claimClass`,
 * `predicate`, `speaker`, `polarity`, `evidence`, `extraction`) are
 * required: a claim without them is not a claim. The facet fields
 * default to unknown or empty, because a facet the document does not
 * support is unknown, not absent-by-error.
 */
export const ExpertReportClaimSchema = z.object({
  id: z.string().trim().min(1),
  reviewSessionId: z.string().trim().min(1),
  claimClass: ClaimClassSchema,
  predicate: CanonicalPredicateSchema,
  speaker: PartyRefSchema,
  attributedTo: PartyRefSchema.optional(),
  adoptionStatus: AdoptionStatusSchema.default("unknown"),
  subjectIds: z.array(z.string().trim()).default([]),
  objectIds: z.array(z.string().trim()).default([]),
  workItemIds: z.array(z.string().trim()).default([]),
  eventIds: z.array(z.string().trim()).default([]),
  programmeIds: z.array(z.string().trim()).default([]),
  documentRefIds: z.array(z.string().trim()).default([]),
  temporal: TemporalContextSchema.default({}),
  values: z.array(ClaimValueSchema).default([]),
  scope: ClaimScopeSchema.default({ kind: "unknown" }),
  delay: DelayContextSchema.optional(),
  quantum: QuantumContextSchema.optional(),
  causation: CausationContextSchema.optional(),
  responsibility: ResponsibilityContextSchema.optional(),
  contractualBasis: z.array(ContractualBasisSchema).optional(),
  evidenceBasis: z.array(EvidenceBasisSchema).default([]),
  modality: ClaimModalitySchema.default("unknown"),
  polarity: z.enum(["positive", "negative"]),
  qualifiers: z.array(QualifierSchema).default([]),
  assertionStrength: AssertionStrengthSchema.default("unknown"),
  scenario: ScenarioContextSchema.optional(),
  evidence: EvidenceAnchorSchema,
  extraction: ExtractionMetadataSchema,
});

export type ExpertReportClaim = z.infer<typeof ExpertReportClaimSchema>;
