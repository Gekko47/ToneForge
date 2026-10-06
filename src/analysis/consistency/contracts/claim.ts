import { z } from "zod";

/**
 * The full claim schema (D1).
 *
 * Every fact the extraction pass asserts about the document is one of these.
 * The schema is deliberately wide: a claim the engine cannot classify is a
 * claim it cannot compare, and an unclassifiable claim silently dropped is a
 * false negative the report would never mention. Unknown stays unknown, and
 * unknown is counted.
 */

/** What kind of fact this claim asserts. */
export const ClaimClassSchema = z.enum([
  "attribution",
  "definition",
  "event",
  "programme",
  "quantum",
  "delay",
  "scope",
  "reference",
  "status",
  "temporal",
  "scenario",
  "causation",
  "responsibility",
  "contractualBasis",
]);

export type ClaimClass = z.infer<typeof ClaimClassSchema>;

/** How the document holds this claim: asserted, adopted, superseded, withdrawn, disputed. */
export const AdoptionStateSchema = z.enum([
  "asserted",
  "adopted",
  "superseded",
  "withdrawn",
  "disputed",
  "unknown",
]);

export type AdoptionState = z.infer<typeof AdoptionStateSchema>;

/** A temporal anchor: when the claimed fact holds. */
export const TemporalAnchorSchema = z.object({
  raw: z.string(),
  iso: z.string().optional(),
  year: z.number().int().optional(),
  month: z.number().int().min(0).max(12).optional(),
  day: z.number().int().min(0).max(31).optional(),
  /** True when the source gave only a coarse date (month, year). */
  coarse: z.boolean().default(false),
});

export type TemporalAnchor = z.infer<typeof TemporalAnchorSchema>;

/** The programme or basis a claim is measured against. */
export const ProgrammeBasisSchema = z.object({
  identifier: z.string(),
  description: z.string().optional(),
});

export type ProgrammeBasis = z.infer<typeof ProgrammeBasisSchema>;

/** A delay claim: how long, against what baseline. */
export const DelayFacetSchema = z.object({
  durationText: z.string(),
  durationDays: z.number().optional(),
  baseline: z.string().optional(),
});

export type DelayFacet = z.infer<typeof DelayFacetSchema>;

/** A quantum claim: a figure with its unit. */
export const QuantumFacetSchema = z.object({
  raw: z.string(),
  value: z.number(),
  unit: z.string(),
  normalized: z.number(),
});

export type QuantumFacet = z.infer<typeof QuantumFacetSchema>;

/** The scenario a claim is stated under (forecast, actual, hypothetical). */
export const ScenarioSchema = z.enum(["actual", "forecast", "hypothetical", "unknown"]);

export type Scenario = z.infer<typeof ScenarioSchema>;

/** Who or what the claim attributes the fact to. */
export const AttributionSchema = z.object({
  subject: z.string(),
  role: z.string().optional(),
});

export type Attribution = z.infer<typeof AttributionSchema>;

/**
 * One structured claim.
 *
 * `id` is the canonical identifier, assigned after evidence validation and
 * stable within a session. `evidenceIds` cite the registry entries that
 * support it; a claim with no resolvable evidence is quarantined, never
 * compared.
 */
export const ExpertReportClaimSchema = z.object({
  id: z.string().trim().min(1),
  class: ClaimClassSchema,
  text: z.string().trim().min(1),
  adoption: AdoptionStateSchema.default("unknown"),
  temporal: TemporalAnchorSchema.optional(),
  programme: ProgrammeBasisSchema.optional(),
  delay: DelayFacetSchema.optional(),
  quantum: QuantumFacetSchema.optional(),
  scenario: ScenarioSchema.default("unknown"),
  causation: z.string().optional(),
  responsibility: z.string().optional(),
  contractualBasis: z.string().optional(),
  attribution: AttributionSchema.optional(),
  evidenceIds: z.array(z.string()).default([]),
  section: z.string().default(""),
});

export type ExpertReportClaim = z.infer<typeof ExpertReportClaimSchema>;
