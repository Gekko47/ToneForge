import { z } from "zod";
import { ConsistencyVerdictSchema } from "./verdict";

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
  checkId: z.string().trim().min(1),
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
  outcome: z.string().optional(),
  /** Free-text reason the adjudicator or the resolver gave. */
  reason: z.string().optional(),
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
