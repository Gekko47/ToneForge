/**
 * Deterministic review contracts.
 *
 * Every shape the deterministic engine returns, plus the two contexts a rule
 * receives. Nothing here imports a provider, Word, or the task pane: the
 * engine's determinism is enforced by the ESLint scope over
 * `src/analysis/deterministic/**`, and this file is where the report type is
 * defined so the scope has something to bite on.
 *
 * **Why the report has no field for a semantic or consistency finding.**
 * Spec §27 gates 1 and 2 require that Deterministic Review make zero LLM calls
 * and that neither Semantic Review nor the C1–C10 engine can contribute to it.
 * A report type with a `kind: "semantic"` hole in its findings array would make
 * both claims a matter of caller discipline. The `findings` array is
 * `DeterministicFinding[]`, whose `kind` cannot be `semantic` or `consistency`,
 * so a leak fails at the type boundary rather than at a review of the engine.
 */

import { z } from "zod";
import { FindingSchema } from "../../core/domain/Finding";
import type { Finding } from "../../core/domain/Finding";
import type { AnalysisContext, AnalysisIdentity } from "../analysisContext";
import type { DocumentNode } from "../../core/domain/DocumentSnapshot";
import type { ResolvedPolicy } from "../../core/domain/ResolvedPolicy";
import type { DeterministicFindingMetadata } from "../../core/domain/Finding";
import type { Change } from "../../core/domain/Change";
import type { DeterministicStyleProfile } from "../../core/domain/StyleProfile";

/**
 * The content kinds a deterministic review can be asked to cover.
 *
 * A closed list rather than free strings, because these are the values the
 * scope policy stores and the coverage report compares against. A typo in a
 * scope flag would otherwise produce a scope that is silently never examined —
 * the same failure mode as the `includeTables: true` default that acquisition
 * could not satisfy, and worse, because nothing would report it.
 */
export const SCOPE_KINDS = [
  "body",
  "headings",
  "lists",
  "tables",
  "sections",
  "headersFooters",
  "textBoxes",
  "fields",
  "contentControls",
  "shapes",
] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/**
 * A finding the deterministic engine may produce.
 *
 * `kind` is narrowed from the four-value `FindingKind` to two. `deterministic`
 * covers the text and language rules; `formatting` covers the paragraph,
 * style, list and table comparisons. The other two are not reachable from here,
 * and narrowing the type is what makes that structural rather than a convention.
 */
export const DeterministicFindingSchema = FindingSchema.extend({
  kind: z.enum(["deterministic", "formatting"]),
});
export type DeterministicFinding = z.infer<typeof DeterministicFindingSchema>;

/**
 * Why a mandatory scope could not be examined.
 *
 * A blocker is a *policy* failure, not a processing gap: the profile or the
 * scope policy asked for this to be checked and it was not. That distinction is
 * what stops the Apply gate treating an unsupported-but-unrequested scope as a
 * reason to refuse a plan over a document nothing asked it to look at.
 */
export const CoverageBlockerSchema = z.object({
  scope: z.enum(SCOPE_KINDS),
  /** The user's words, not an internal symbol. */
  reason: z.string().trim().min(1),
  /** Whether the policy asked for this scope and the host could not serve it. */
  cause: z.enum(["unsupportedByHost", "excludedByPolicy", "protected"]),
});
export type CoverageBlocker = z.infer<typeof CoverageBlockerSchema>;

/**
 * What a deterministic review did and did not examine.
 *
 * Spec §9: scope means `requested ∩ host-supported`. The four lists are kept
 * separate rather than collapsed into a percentage, because the remedies
 * differ. `unsupportedScopes` is a host limitation the user cannot change;
 * `excludedByPolicyScopes` is their own decision; `protectedScopes` is content
 * they locked. A single "coverage" number would answer none of those.
 */
export const DeterministicCoverageSchema = z.object({
  /** What the scope policy asked for. */
  requestedScopes: z.array(z.enum(SCOPE_KINDS)).default([]),
  /** What this run actually compared. */
  examinedScopes: z.array(z.enum(SCOPE_KINDS)).default([]),
  /** Asked for, and the host could not serve. */
  unsupportedScopes: z.array(z.enum(SCOPE_KINDS)).default([]),
  /** Asked for, and the policy or protection kept out. */
  excludedScopes: z.array(z.enum(SCOPE_KINDS)).default([]),
  /** Acquired, but the user marked it protected. */
  protectedScopes: z.array(z.enum(SCOPE_KINDS)).default([]),

  textCharactersExamined: z.number().int().nonnegative().default(0),
  paragraphsExamined: z.number().int().nonnegative().default(0),
  headingsExamined: z.number().int().nonnegative().default(0),
  listsExamined: z.number().int().nonnegative().default(0),
  tablesExamined: z.number().int().nonnegative().default(0),
  sectionsExamined: z.number().int().nonnegative().default(0),
  headersFootersExamined: z.number().int().nonnegative().default(0),

  /**
   * True when every requested scope was examined.
   *
   * This is the gate on any whole-document compliance claim. It is computed
   * from `requestedScopes` against `examinedScopes`, not from whether a run
   * happened to find nothing — a run that examined everything and found nothing
   * is complete, and a run that examined a third of the document and found
   * nothing is not.
   */
  complete: z.boolean().default(false),
  blockers: z.array(CoverageBlockerSchema).default([]),

  /**
   * A stable digest of the examined scope.
   *
   * Part of the review-session fingerprint (spec §16): a session whose coverage
   * fingerprint changed examined a different amount of the document, so its
   * approvals cannot be carried across even when the document is unchanged.
   */
  coverageFingerprint: z.string().trim().min(1).default(""),
});
export type DeterministicCoverage = z.infer<typeof DeterministicCoverageSchema>;

/**
 * Equivalent findings, offered for batch approval.
 *
 * Spec §13 permits `Approve all` only when every occurrence is the same rule
 * with the same expected correction, every precondition holds, nothing
 * conflicts, no target is protected, risk is within policy, and the correction
 * is semantically neutral. `safeBatchApproval` is that verdict, computed once
 * at grouping time — a group that is not safe has no "approve all" control at
 * all, rather than one the user has to be trusted not to press.
 */
export const DeterministicFindingGroupSchema = z.object({
  id: z.string().trim().min(1),
  /** The finding category, which is the user-facing name of the rule. */
  category: z.string().trim().min(1),
  ruleId: z.string().trim().min(1),
  /** The correction every member shares. `undefined` when there is none. */
  expected: z.unknown().optional(),
  /** Occurrence ids, in document order. */
  occurrenceIds: z.array(z.string().uuid()).default([]),
  /**
   * Whether `Approve all` may be offered for this group.
   *
   * A group of one is always safe: approving one occurrence is approving it.
   */
  safeBatchApproval: z.boolean().default(false),
  /** Why batch approval is refused, when it is. */
  batchRefusalReason: z.string().trim().min(1).optional(),
});
export type DeterministicFindingGroup = z.infer<typeof DeterministicFindingGroupSchema>;

/** Counts, split the way the Review UI groups them (spec §22). */
export const DeterministicReviewSummarySchema = z.object({
  total: z.number().int().nonnegative().default(0),
  /** Findings with a safe correction the user can approve. */
  actionable: z.number().int().nonnegative().default(0),
  /** Findings reported with no correction available. */
  reportedOnly: z.number().int().nonnegative().default(0),
  bySeverity: z
    .object({
      info: z.number().int().nonnegative().default(0),
      warning: z.number().int().nonnegative().default(0),
      error: z.number().int().nonnegative().default(0),
    })
    .default({ info: 0, warning: 0, error: 0 }),
  /**
   * The three groups the Review UI shows as separate cards (spec §22).
   *
   * `language` is the text and terminology rules, `formatting` the paragraph
   * and style comparisons, `structure` the document-shape rules. A fourth
   * bucket for integrity findings would be more precise, and the UI would then
   * show a group of one for a category a reader has no vocabulary for.
   */
  byCategoryGroup: z
    .object({
      language: z.number().int().nonnegative().default(0),
      formatting: z.number().int().nonnegative().default(0),
      structure: z.number().int().nonnegative().default(0),
    })
    .default({ language: 0, formatting: 0, structure: 0 }),
});
export type DeterministicReviewSummary = z.infer<typeof DeterministicReviewSummarySchema>;

/**
 * What one deterministic review produced.
 *
 * `profileId` and `profileRevision` travel together because a finding says
 * "the profile called for X" and that is only meaningful against the exact
 * revision that called for it. A plan built under one revision cannot answer
 * for another, which is why the review session binds both.
 */
export const DeterministicReviewReportSchema = z.object({
  /** A literal, not a free string: this report *is* the deterministic one. */
  reviewType: z.literal("deterministic"),
  documentIdentity: z.object({
    documentId: z.string().trim().min(1),
    documentVersion: z.string().trim().min(1),
    contentHash: z.string().trim().min(1),
    structuralHash: z.string().trim().min(1),
  }),
  profileId: z.string().uuid(),
  profileRevision: z.number().int().nonnegative(),
  findings: z.array(DeterministicFindingSchema).default([]),
  groups: z.array(DeterministicFindingGroupSchema).default([]),
  coverage: DeterministicCoverageSchema,
  summary: DeterministicReviewSummarySchema,
});
export type DeterministicReviewReport = z.infer<typeof DeterministicReviewReportSchema>;

/** What a caller hands the engine. */
export interface DeterministicReviewOptions {
  /**
   * The acquired evidence.
   *
   * Required, and there is deliberately no `text` or `snapshot` shorthand. The
   * old checker accepted a loose `{ text, profile, snapshot }` bag, which is
   * how a run could be given a text sample with no nodes and then report
   * coverage for a document it never acquired.
   */
  context: AnalysisContext;
  /**
   * The normative policy. Supplied when the caller already owns the resolved
   * snapshot; derived from `context.policy` otherwise. A pre-resolved policy
   * for a different profile is refused rather than silently applied.
   */
  resolvedPolicy?: ResolvedPolicy;
  /** The nodes this run examined, when a strict subset of the acquired nodes. */
  examinedNodeIds?: readonly string[];
  /** True when `examinedNodeIds` is a strict subset of the acquired nodes. */
  incremental?: boolean;
  /** Why the run was partial, in the user's terms. */
  incrementalReason?: string;
}

/**
 * What a rule receives to analyze a document.
 *
 * Everything is derived from the AnalysisContext the Word boundary produced, so
 * a rule cannot read the live document: it can only read what acquisition
 * proved. The `profile` is the resolved deterministic profile rather than the
 * raw `StyleProfile`, so a rule sees the normative merge the governance author
 * intended rather than re-deriving precedence itself.
 */
export interface DeterministicRuleContext {
  /** The acquired, host-neutral context. */
  context: AnalysisContext;
  /** The resolved deterministic profile. */
  profile: DeterministicStyleProfile;
  /** The normative policy the rules run under. */
  policy: ResolvedPolicy;
  /** The nodes this run examined. Equals `context.nodes` on a full scan. */
  examinedNodes: readonly DocumentNode[];
}

/** What a rule receives to plan a correction. */
export interface DeterministicPlanContext {
  context: AnalysisContext;
  profile: DeterministicStyleProfile;
  policy: ResolvedPolicy;
}

/** Narrow a general `Finding` to one the deterministic engine may produce. */
export function asDeterministicFinding(finding: Finding): DeterministicFinding | null {
  if (finding.kind !== "deterministic" && finding.kind !== "formatting") return null;
  const parsed = DeterministicFindingSchema.safeParse(finding);
  return parsed.success ? parsed.data : null;
}

/**
 * The metadata a deterministic finding carries.
 *
 * Returns a definite value rather than `undefined` so a caller reading
 * `metadataOf(f).profilePath` does not need a guard, and an empty `profilePath`
 * is the honest answer for a finding produced before the rule attached one —
 * which is itself worth seeing, since spec §11's audit asks exactly that
 * question.
 */
export function metadataOf(finding: DeterministicFinding): DeterministicFindingMetadata {
  return finding.deterministic ?? EMPTY_METADATA;
}

/**
 * The metadata a finding carries when its rule attached none.
 *
 * A frozen module constant rather than a `parse` on every call. The earlier
 * version parsed `{ profilePath: "" }` at the call site, and that threw: the
 * field is `min(1)`, precisely so a rule cannot declare an empty profile path.
 * The two decisions are both right and together they made the helper throw on
 * every finding produced by a rule that has not been updated yet — which is all
 * of them at the point of writing, so every scan failed and the observer
 * reported a scan error instead of findings.
 *
 * The empty default is the honest answer and is stated as one, rather than
 * papered over by loosening the schema: a finding with no declared path is
 * exactly what it is, and the §11 audit is the thing that should notice.
 */
const EMPTY_METADATA: DeterministicFindingMetadata = Object.freeze({
  profilePath: "",
});

/** Whether a finding offers a correction the planner can act on. */
export function isCorrectable(finding: DeterministicFinding): boolean {
  const metadata = metadataOf(finding);
  if (metadata.correctionAvailable !== undefined) return metadata.correctionAvailable;
  return finding.actionable !== false;
}

/** A `Change` the deterministic engine may produce. */
export type DeterministicChange = Change;

/** Re-exported so a rule module needs one import, not three. */
export type { AnalysisIdentity, AnalysisContext, ResolvedPolicy, DeterministicFindingMetadata };
