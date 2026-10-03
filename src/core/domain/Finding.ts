/**
 * Unified Finding model used by the deterministic, semantic, formatting, and
 * cross-report consistency engines. Rules/UI never mutate Word directly —
 * findings feed ChangePlan.
 */

import { z } from "zod";
import { ChangePreconditionSchema } from "./Change";

/**
 * `consistency` is its own kind rather than a flavour of `semantic`.
 *
 * The difference is not cosmetic. Consistency findings come from the one engine
 * that is non-deterministic by design (ADR-0052), so a user reviewing a plan
 * must be able to tell at a glance which findings came from a comparison that
 * could be wrong. Folding them into `semantic` would hide exactly the property
 * that matters most about them.
 */
export const FindingKindSchema = z.enum(["deterministic", "semantic", "formatting", "consistency"]);
export type FindingKind = z.infer<typeof FindingKindSchema>;

export const SeveritySchema = z.enum(["info", "warning", "error"]);
export type Severity = z.infer<typeof SeveritySchema>;

/*
 * What the two numbers on a finding's `range` count.
 *
 * `table`, `header` and `footer` were added because `section` was doing three
 * jobs. `sectionRange(table.index)` produced a finding that said, in the task
 * pane's own words, "Location: 2–3 (section)" on a table — and
 * `ChangeTargetSchema` would have turned that into a section target had the
 * finding ever been planned. Naming the structure removes the ambiguity rather
 * than leaving it for a reader to guess at.
 *
 * These are *units of counting*, which is why they are here and not on the
 * target: `start` and `end` are the count in the named unit. `FindingTarget`
 * below says what the finding is about, which is a different question.
 */
export const RangeSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    unit: z
      .enum(["character", "paragraph", "section", "table", "header", "footer"])
      .default("character"),
  })
  .refine((r) => r.start <= r.end, {
    message: "Range.start must be <= Range.end",
    path: ["start"],
  });

export type Range = z.infer<typeof RangeSchema>;

/**
 * What a finding is about, structurally.
 *
 * **`range` alone could not answer this.** A table finding and a page-setup
 * finding both carried `{ start: index, end: index + 1, unit: "section" }`, and a
 * header finding carried its *section's* index under the same three numbers. A
 * consumer that wanted to take the user to the thing could not, because nothing
 * distinguished them. This is the discriminated union that does.
 *
 * It mirrors `ChangeTargetSchema` in `Change.ts` rather than being a second
 * dialect: same `kind`-keyed shape, same optional `nodeId` / `structuralPath`
 * spelling, so a target can be read by anything that already reads a change
 * target. `header` and `footer` carry `sectionIndex` because that is the fact
 * the analyzer had to re-derive from a `sourcePath` regex and the one a reader
 * needs in order to find the right section.
 */
export const FindingTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("paragraph"),
    index: z.number().int().nonnegative(),
    nodeId: z.string().trim().min(1).optional(),
    structuralPath: z.string().trim().min(1).optional(),
  }),
  z.object({
    /** A list is addressed by the paragraph that carries the list item. */
    kind: z.literal("list"),
    paragraphIndex: z.number().int().nonnegative(),
    nodeId: z.string().trim().min(1).optional(),
    structuralPath: z.string().trim().min(1).optional(),
  }),
  z.object({
    kind: z.literal("table"),
    index: z.number().int().nonnegative(),
    nodeId: z.string().trim().min(1).optional(),
    structuralPath: z.string().trim().min(1).optional(),
  }),
  z.object({
    kind: z.literal("header"),
    sectionIndex: z.number().int().nonnegative(),
    index: z.number().int().nonnegative(),
    nodeId: z.string().trim().min(1).optional(),
    structuralPath: z.string().trim().min(1).optional(),
  }),
  z.object({
    kind: z.literal("footer"),
    sectionIndex: z.number().int().nonnegative(),
    index: z.number().int().nonnegative(),
    nodeId: z.string().trim().min(1).optional(),
    structuralPath: z.string().trim().min(1).optional(),
  }),
  z.object({
    kind: z.literal("section"),
    index: z.number().int().nonnegative(),
    nodeId: z.string().trim().min(1).optional(),
    structuralPath: z.string().trim().min(1).optional(),
  }),
]);
export type FindingTarget = z.infer<typeof FindingTargetSchema>;

export const FindingSourceSchema = z.enum(["deterministic", "ai", "profile", "user"]);
export type FindingSource = z.infer<typeof FindingSourceSchema>;

export const FindingRiskSchema = z.enum(["none", "low", "medium", "high"]);
export type FindingRisk = z.infer<typeof FindingRiskSchema>;

export const FindingStatusSchema = z.enum(["new", "reviewed", "accepted", "ignored", "deferred"]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const FindingTransformationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("case"),
    style: z.enum(["sentence", "title"]),
    text: z.string(),
  }),
  z.object({
    kind: z.literal("replace"),
    text: z.string(),
  }),
]);

/**
 * What a deterministic finding knows about the profile that produced it.
 *
 * **Why this is metadata and not a field on the finding itself.** A finding
 * carries `expected` and `actual` as strings, which is all the task pane needs
 * to render "before → after". The profile *path* that produced them is not
 * display: it is what makes a finding explainable ("this is
 * `houseStyle.terminology`, not a spelling rule") and groupable (`occurrence
 * group key` and `safe batch key` both derive from it). Putting it on the
 * finding as three more scalar fields would let a rule set `expected` without
 * saying which profile field produced it, and a finding that cannot name its
 * origin cannot be audited against the profile.
 *
 * `correctionAvailable` is separate from the finding's own `actionable` flag on
 * purpose. `actionable: false` means the *engine* declined to write, which
 * covers a semantic finding with no anchored span. `correctionAvailable: false`
 * with a `correctionReason` means the engine found a real deviation and is
 * saying the adapter cannot safely fix it in this host — a different fact, and
 * the one spec §14.7 asks the UI to state in those words.
 */
export const DeterministicFindingMetadataSchema = z.object({
  /**
   * The profile field that produced this finding, e.g.
   * `houseStyle.terminology.program` or `formatting.headings.2.styleName`.
   *
   * Required rather than defaulted. `min(1)` exists so a rule cannot declare an
   * empty profile path, and a default of `""` beside it is not a fallback at
   * all — Zod validates the default it just applied, so parsing a metadata
   * record without a path threw instead of yielding one. A deterministic finding
   * has to name the field it came from; where a caller genuinely has none, the
   * honest answers are to omit the metadata or to name the absence explicitly,
   * not to parse an empty string.
   */
  profilePath: z.string().trim().min(1),
  /** The profile's configured value. `undefined` when the profile is silent. */
  expected: z.unknown().optional(),
  /** What the document actually has. `undefined` when nothing was acquired. */
  actual: z.unknown().optional(),
  /**
   * Findings sharing this key describe the same deviation of the same field.
   *
   * Grouping is by this rather than by category, because a category can hold
   * both "em dash spacing is tight" and "em dash spacing is loose" — two
   * different corrections that must never be batch-approved together.
   */
  occurrenceGroupKey: z.string().trim().min(1).optional(),
  /**
   * The key two findings must share to be batch-approvable together.
   *
   * Distinct from `occurrenceGroupKey` on purpose: this one is a *safety* key,
   * and the engine sets it only when the correction is identical and provably
   * semantically neutral. A group may hold many occurrences and still refuse
   * batch approval, which is the common case for a formatting finding.
   */
  safeBatchKey: z.string().trim().min(1).optional(),
  /** Whether a safe correction exists for this finding in this host. */
  correctionAvailable: z.boolean().optional(),
  /**
   * Why no correction is offered, in the user's words.
   *
   * Spec §14.7: "Detected, but ToneForge cannot safely correct this property in
   * this Word host." The engine's own sentence, quoted by the UI rather than
   * paraphrased, so the reason a control is missing is never a reworded guess.
   */
  correctionReason: z.string().trim().min(1).optional(),
});
export type DeterministicFindingMetadata = z.infer<typeof DeterministicFindingMetadataSchema>;

export const FindingSchema = z.object({
  id: z.string().uuid(),
  kind: FindingKindSchema,
  category: z.string().trim().min(1),
  range: RangeSchema,
  /**
   * What the finding is about, structurally.
   *
   * Optional because most findings are about text and `range` already says so.
   * Required on the structural ones — a table, header, footer, section or list
   * finding — because `range` counts in a unit that does not say which thing of
   * that kind, and `Go to item` has to be able to resolve it.
   */
  target: FindingTargetSchema.optional(),
  message: z.string().trim().min(1),
  severity: SeveritySchema,
  evidence: z.string().trim().default(""),
  suggestedChangeId: z.string().optional(),
  ruleId: z.string().trim().min(1).optional(),
  confidence: z.number().min(0).max(1).default(1),
  /** False when a finding is informational only and cannot produce a change. */
  actionable: z.boolean().optional(),
  advisoryReason: z.string().trim().min(1).optional(),
  // --- additive fields (Phase A) ---
  nodeIds: z.array(z.string().trim().min(1)).default([]),
  source: FindingSourceSchema.default("deterministic"),
  risk: FindingRiskSchema.default("none"),
  reversible: z.boolean().default(true),
  status: FindingStatusSchema.default("new"),
  actual: z.string().optional(),
  expected: z.string().optional(),
  explanation: z.string().optional(),
  transformation: FindingTransformationSchema.optional(),
  precondition: ChangePreconditionSchema.optional(),
  /**
   * Deterministic-rule provenance. Absent on semantic and consistency findings,
   * which have no profile field to name.
   */
  deterministic: DeterministicFindingMetadataSchema.optional(),
});

export type Finding = z.infer<typeof FindingSchema>;

/**
 * A finding the user chose to ignore, stored by fingerprint.
 *
 * The fingerprint is the identity of the *problem*, not of one detection run:
 * `findingFingerprint` deliberately excludes the generated uuid and the absolute
 * character offset, so an ignore survives a rescan and survives text shifting
 * above it. Keying by `finding.id` instead would expire every ignore at the next
 * scan, and the ignore list would read as broken.
 *
 * The subset of fields stored is what the ignored list needs to render and to
 * offer "Go to text" and "Restore". Nothing capable of holding document text is
 * included beyond what the user already saw on the card.
 */
export const IgnoredFindingSchema = z.object({
  fingerprint: z.string().trim().min(1),
  findingId: z.string().uuid(),
  category: z.string().trim().min(1),
  message: z.string().trim().min(1),
  range: RangeSchema,
  nodeIds: z.array(z.string().trim().min(1)).default([]),
  ignoredAt: z.string().datetime(),
  /**
   * The occurrence this ignore covers.
   *
   * Stored alongside the fingerprint rather than replacing it. The fingerprint is
   * the identity of the *rule* and is what makes the list readable; the occurrence
   * key is what makes two hits of the same rule separately ignorable. Keeping
   * both is what lets Restore address one row instead of every row of that rule.
   *
   * Optional and unconstrained rather than `min(1).default("")`: a row written
   * before the key existed parses as an empty string, and a key that is absent
   * is a different fact from a key that is malformed. A minimum length would
   * reject the old rows outright and take the user's ignores with them.
   */
  occurrenceKey: z.string().trim().default(""),
});
export type IgnoredFinding = z.infer<typeof IgnoredFindingSchema>;

/**
 * A finding the user reviewed, stored as a decision rather than as a status.
 *
 * **Why it is a separate record and not `Finding.status = "reviewed"`.** The
 * status field is written by the observer, which knows nothing about what the
 * user did, so the pane had to patch the observer's data back after every scan.
 * Worse, the review has to survive a *different run*: the observer's scan and the
 * preview that builds the plan are separate passes that issue separate uuids, so
 * a review recorded against the id the user clicked could never be recognised in
 * the plan Apply actually writes. Storing the decision under an occurrence
 * identity — rather than under an id or a bare rule fingerprint — is what makes
 * the two passes agree.
 *
 * `changeId` records the change the review resolved to, when one exists. A review
 * with no eligible change is still a real decision ("I have seen this, it needs
 * no correction"), so it is kept and reported rather than discarded.
 */
export const ReviewedFindingSchema = z.object({
  /** `reviewIdentity` of the finding the user reviewed. Exact by design. */
  identity: z.string().trim().min(1),
  findingId: z.string().uuid(),
  category: z.string().trim().min(1),
  range: RangeSchema,
  nodeIds: z.array(z.string().trim().min(1)).default([]),
  reviewedAt: z.string().datetime(),
  /**
   * The plan change this review admitted, or null when the finding produced none.
   *
   * Null is a real outcome, not a missing value: most findings are advisory and
   * the planner has no correction for them. Recording that explicitly is what
   * lets the pane say "reviewed, and there is nothing to apply" instead of
   * treating the finding as unreviewed and asking again.
   */
  changeId: z.string().uuid().nullable().default(null),
  /** Why no change was admitted, when none was. The engine's own words. */
  noChangeReason: z.string().trim().min(1).nullable().default(null),
});
export type ReviewedFinding = z.infer<typeof ReviewedFindingSchema>;
