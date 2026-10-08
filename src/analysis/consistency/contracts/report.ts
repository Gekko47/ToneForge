import { z } from "zod";
import { ConsistencyCheckIdSchema } from "./checkIds";
import { ConsistencyVerdictSchema } from "./verdict";
import { DOutcomeSchema } from "./evaluation";

/**
 * One issue in the finished report.
 *
 * The shape is stable across the replacement: the UI and the findings pipeline
 * read `checkId`, `confidence`, `actionable`, `evidence`, `nodeIds`, `ranges`,
 * `suggestedText` and `suggestedNodeId`, and the bridge maps this to a
 * `Finding` preserving `kind: "consistency"`.
 *
 * `actionable` is false below `CONSISTENCY_ACTIONABLE_CONFIDENCE`. A finding
 * that is not actionable is advisory: it is shown, it is explained, and the
 * planner produces nothing from it.
 */
export const ConsistencyIssueSchema = z.object({
  checkId: ConsistencyCheckIdSchema,
  fingerprint: z.string().trim().min(1),
  title: z.string().trim().min(1),
  detail: z.string().trim().min(1),
  severity: z.enum(["info", "warning", "error"]),
  confidence: z.number().min(0).max(1),
  actionable: z.boolean(),
  nodeIds: z.array(z.string()),
  ranges: z
    .object({
      left: z.object({ start: z.number().int(), end: z.number().int() }),
      right: z.object({ start: z.number().int(), end: z.number().int() }),
    })
    .optional(),
  evidence: z.object({
    left: z.string(),
    right: z.string(),
    sectionLeft: z.string(),
    sectionRight: z.string(),
  }),
  suggestedText: z.string().optional(),
  suggestedNodeId: z.string().optional(),
  verdict: ConsistencyVerdictSchema.optional(),
  /** The D-outcome the engine derived, when one applies (D8). */
  outcome: DOutcomeSchema.optional(),
  /** Free-text reason the adjudicator or the resolver gave. */
  reason: z.string().optional(),
  /**
   * Why-confidence provenance (original §33): the human-readable E-results
   * behind the score, each with its source. The UI renders this under
   * "Why N%?" so a reader can see which facets were proven deterministically
   * and which a model judged. Absent when the engine has nothing to show.
   */
  whyConfidence: z
    .array(
      z.object({
        /** The E-question, in the user's terms. */
        label: z.string().trim().min(1),
        /** How strongly the facet holds, in the user's terms. */
        strength: z.string().trim().min(1),
        /** Who answered it: a proven fact or a model judgement. */
        provenance: z.enum(["deterministic", "system_one", "mixed"]),
      }),
    )
    .optional(),
});

export type ConsistencyIssue = z.infer<typeof ConsistencyIssueSchema>;

/**
 * What the run covered, and what it did not.
 *
 * `complete` is a discovery claim, not a type requirement (ADR-0066): it is
 * true only when nothing was skipped and nothing was left unreviewed. A run
 * that hit a budget cap reports `complete: false` with the skipped counts in
 * `limitations`, and the UI renders the limitation rather than a clean bill of
 * health.
 */
export const ConsistencyCoverageSchema = z.object({
  complete: z.boolean(),
  statementsConsidered: z.number().int().min(0),
  statementsTotal: z.number().int().min(0),
  comparisonsMade: z.number().int().min(0),
  blockOverflowSkipped: z.number().int().min(0),
  adjudicationsUsed: z.number().int().min(0),
  adjudicationsAvailable: z.number().int().min(0),
  perCheck: z.record(z.string(), z.number().int().min(0)),
  limitations: z.array(z.string()),
  modelAdjudicated: z.number().int().min(0),
  /**
   * Claims the evidence validator quarantined because their
   * evidence could not be resolved (corrupt offsets, a hash
   * mismatch, text that is not there). Counted, never silent:
   * a quarantined claim is a claim the report refused to
   * compare, and the coverage says so.
   */
  quarantinedClaims: z.number().int().min(0).default(0),
  /**
   * Coverage V3 (original §34): the work is separated by how it was
   * settled, so a reader can tell a deterministic proof from a model
   * judgement from work that was never finished. Every field defaults
   * to 0 so a report written before V3 still parses.
   *
   * - `deterministicResolved`: candidates a gate or the resolver settled
   *   with no model call.
   * - `decisionAdjudicated`: candidates the decision model answered.
   * - `unresolved`: candidates left unresolved (no model, or a model
   *   failure) — the honest residue.
   * - `gated`: candidates a hard gate terminated before the model.
   * - `reviewBandSuppressed`: candidates above the presentation threshold
   *   but below the review threshold, shown as advisory only.
   * - `budgetExceeded`: candidates dropped because a cap was hit.
   */
  deterministicResolved: z.number().int().min(0).default(0),
  decisionAdjudicated: z.number().int().min(0).default(0),
  unresolved: z.number().int().min(0).default(0),
  gated: z.number().int().min(0).default(0),
  reviewBandSuppressed: z.number().int().min(0).default(0),
  budgetExceeded: z.number().int().min(0).default(0),
});

export type ConsistencyCoverage = z.infer<typeof ConsistencyCoverageSchema>;

/**
 * The finished report.
 *
 * Tied to the revision it was produced against. A consumer that still holds a
 * report for a revision the document has since left can tell, from `revision`,
 * that the findings belong to text that has changed.
 */
export const ConsistencyReportSchema = z.object({
  revision: z.string().trim().min(1),
  issues: z.array(ConsistencyIssueSchema),
  coverage: ConsistencyCoverageSchema,
  usedModel: z.boolean(),
  startedAt: z.string(),
  finishedAt: z.string(),
});

export type ConsistencyReport = z.infer<typeof ConsistencyReportSchema>;

/**
 * Live progress for one run.
 *
 * A phase and a fraction, not a batch count: the engine has no batches, so
 * naming the phases lets a user tell a long comparison from a stuck one.
 */
export const ConsistencyProgressSchema = z.object({
  phase: z.enum([
    "segmenting",
    "extracting",
    "normalising",
    "indexing",
    "comparing",
    "adjudicating",
    "consolidating",
    "done",
  ]),
  fraction: z.number().min(0).max(1),
  message: z.string(),
});

export type ConsistencyProgress = z.infer<typeof ConsistencyProgressSchema>;
