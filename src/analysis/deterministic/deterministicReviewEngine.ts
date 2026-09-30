/**
 * The deterministic review engine.
 *
 * Spec §3.1. The single entry point for Deterministic Review, and the only
 * path that produces a `DeterministicReviewReport`.
 *
 * **What is deliberately absent.** There is no `includeRawText` option and no
 * provider parameter, and the module cannot import `ai` — the ESLint scope over
 * `src/analysis/deterministic/**` makes that a build failure rather than a
 * review comment. The old `checkConsistency` carried both, and the semantic
 * branch behind them was unreachable: no production caller passed
 * `includeRawText`. Deleting it removes a claim the code could not back.
 *
 * Boundary rule: this module reads an `AnalysisContext` and produces findings.
 * It never calls `Office.run` and never mutates the document.
 */

import { deterministicProfileOf } from "../../core/domain/StyleProfile";
import type { StyleProfile } from "../../core/domain/StyleProfile";
import { resolveResolvedPolicy } from "../../core/domain/ResolvedPolicy";
import type { ResolvedPolicy } from "../../core/domain/ResolvedPolicy";
import type { DocumentNode } from "../../core/domain/DocumentSnapshot";
import type { Finding } from "../../core/domain/Finding";
import {
  asDeterministicFinding,
  DeterministicReviewReportSchema,
  DeterministicReviewSummarySchema,
  isCorrectable,
  metadataOf,
  type DeterministicFinding,
  type DeterministicFindingGroup,
  type DeterministicReviewOptions,
  type DeterministicReviewReport,
  type DeterministicReviewSummary,
  type DeterministicRuleContext,
  type ScopeKind,
} from "./contracts";
import { buildDeterministicCoverage } from "./coverage";
import { allRules, ruleByCategory, type DeterministicRule, type RuleGroup } from "./ruleRegistry";

/**
 * The scope kinds each rule group applies to.
 *
 * A group is skipped entirely when none of its scopes is in the examined set.
 * Without it, a text rule would run over a document whose text acquisition
 * failed and report findings against text it could not read.
 */
const GROUP_SCOPES: Readonly<Record<RuleGroup, readonly ScopeKind[]>> = {
  language: ["body", "headersFooters"],
  typography: ["body", "headersFooters"],
  formatting: ["body", "headings", "lists", "tables", "sections", "headersFooters"],
  structure: ["body", "headings"],
  integrity: ["body", "headings"],
};

/**
 * The three buckets spec §22 shows as separate cards.
 *
 * A fourth for integrity findings was considered and rejected: a category a
 * reader has no vocabulary for, alone in its own card, teaches them nothing and
 * gives the header a number they cannot place.
 */
function groupOf(finding: DeterministicFinding): "language" | "formatting" | "structure" {
  if (finding.kind === "formatting") {
    return finding.category.startsWith("formatting.heading") ||
      finding.category.startsWith("formatting.empty") ||
      finding.category.startsWith("formatting.unknown")
      ? "structure"
      : "formatting";
  }
  return "language";
}

/** The severity and actionability counts the report carries. */
export function summarize(findings: readonly DeterministicFinding[]): DeterministicReviewSummary {
  const summary = DeterministicReviewSummarySchema.parse({});
  findings.forEach((finding) => {
    summary.total += 1;
    summary.bySeverity[finding.severity] += 1;
    if (isCorrectable(finding)) summary.actionable += 1;
    else summary.reportedOnly += 1;
    summary.byCategoryGroup[groupOf(finding)] += 1;
  });
  return summary;
}

/**
 * Group equivalent findings so the user can approve a run of them at once.
 *
 * Spec §13 permits batch approval only when the occurrences are the same rule
 * with the same expected correction, no conflicts, no protected targets, risk
 * within policy, and the correction semantically neutral. The first three are
 * checkable here; the last two are the planner's and the adapter's to answer at
 * apply time, so the group records the verdict it *can* reach and the plan gate
 * still refuses anything it cannot prove.
 *
 * A group of one is always safe: approving one occurrence is approving it.
 */
export function groupFindings(
  findings: readonly DeterministicFinding[],
  protectedNodeIds: ReadonlySet<string>,
): DeterministicFindingGroup[] {
  const buckets = new Map<string, DeterministicFinding[]>();
  findings.forEach((finding) => {
    const metadata = metadataOf(finding);
    // The occurrence group key, not the category: a category can hold both
    // "spacing is tight" and "spacing is loose", which are two corrections
    // that must never be approved together.
    const key = metadata.occurrenceGroupKey ?? `${finding.category}|${metadata.profilePath}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(finding);
    else buckets.set(key, [finding]);
  });

  return Array.from(buckets.entries()).map(([key, occurrences]) => {
    const [first] = occurrences;
    if (first === undefined) {
      throw new Error("A finding group cannot be built from an empty bucket");
    }
    const metadata = metadataOf(first);
    const nodeIds = occurrences.flatMap((finding) => finding.nodeIds);
    const protectedOccurrence = nodeIds.some((nodeId) => protectedNodeIds.has(nodeId));
    const differingExpected = occurrences.some(
      (finding) =>
        JSON.stringify(metadataOf(finding).expected) !== JSON.stringify(metadata.expected),
    );
    const singleRule = occurrences.every((finding) => finding.ruleId === first.ruleId);
    const single = occurrences.length === 1;
    const sameBatchKey = occurrences.every(
      (finding) => metadataOf(finding).safeBatchKey === metadata.safeBatchKey,
    );

    let safeBatchApproval = true;
    let batchRefusalReason: string | undefined;
    if (!singleRule) {
      safeBatchApproval = false;
      batchRefusalReason = "these occurrences come from more than one rule";
    } else if (differingExpected) {
      safeBatchApproval = false;
      batchRefusalReason = "these occurrences do not share one correction";
    } else if (protectedOccurrence) {
      safeBatchApproval = false;
      batchRefusalReason = "one of these occurrences is in a protected range";
    } else if (!single && metadata.safeBatchKey === undefined) {
      // No declared batch key means the rule never asserted the correction is
      // semantically neutral. One occurrence needs no such assertion; several
      // do, and assuming it would be the unsafe direction.
      safeBatchApproval = false;
      batchRefusalReason = "this rule has not declared these corrections safe to apply as a batch";
    }
    if (single) {
      safeBatchApproval = true;
      batchRefusalReason = undefined;
    }
    if (!sameBatchKey && !single) {
      safeBatchApproval = false;
    }

    return {
      id: key,
      category: first.category,
      ruleId: first.ruleId ?? ruleByCategory(first.category)?.id ?? first.category,
      ...(metadata.expected === undefined ? {} : { expected: metadata.expected }),
      occurrenceIds: occurrences.map((finding) => finding.id),
      safeBatchApproval,
      ...(batchRefusalReason === undefined ? {} : { batchRefusalReason }),
    } satisfies DeterministicFindingGroup;
  });
}

/**
 * Run a deterministic review over an acquired document scope.
 *
 * Throws rather than returning an empty report when the profile is not
 * deterministic or a supplied policy belongs to a different profile: a report
 * built from the wrong profile would attribute every finding to a standard the
 * user never chose, which is worse than no report.
 */
export async function runDeterministicReview(
  options: DeterministicReviewOptions,
): Promise<DeterministicReviewReport> {
  const { context } = options;
  if (context.text.trim().length === 0) {
    return buildReport({
      profile: context.profile,
      policy: resolveResolvedPolicy(context.profile, context.policy),
      findings: [],
      coverage: buildDeterministicCoverage({ context }),
      context,
      ...(options.examinedNodeIds === undefined
        ? {}
        : { examinedNodeIds: options.examinedNodeIds }),
    });
  }

  assertDeterministicProfile(context.profile);
  const policy =
    options.resolvedPolicy === undefined
      ? resolveResolvedPolicy(context.profile, context.policy)
      : options.resolvedPolicy;
  if (policy.profile.id !== context.profile.id) {
    throw new Error(
      "runDeterministicReview received a resolvedPolicy resolved from a different StyleProfile",
    );
  }

  const examinedNodeIds = resolveExaminedNodeIds(context.nodes, options.examinedNodeIds);
  const coverage = buildDeterministicCoverage({
    context,
    examinedNodeIds,
  });
  const profile = deterministicProfileOf(policy.profile);
  const examinedNodes = context.nodes.filter((node) => examinedNodeIds.includes(node.nodeId));
  const ruleContext: DeterministicRuleContext = {
    context,
    profile,
    policy,
    examinedNodes,
  };

  /*
   * Dispatch through the registry rather than calling the scanners here.
   *
   * Two things depend on this. Spec §11's audit reads `DETERMINISTIC_RULES`, so
   * an engine that bypassed it would let the audit pass while the engine ran a
   * different rule set — the audit would describe a registry nothing consults.
   * And a rule with no `analyze` is then genuinely *not run*, rather than
   * silently covered by a neighbouring scanner that happens to share its
   * categories.
   *
   * Each rule is gated on a scope the run actually examined, so a host that
   * served no text produces no text findings rather than findings against text
   * nobody read.
   */
  const findings = narrowAll(
    allRules().flatMap((rule) => {
      if (!ruleRuns(rule, coverage.examinedScopes)) return [];
      return rule.analyze === undefined ? [] : rule.analyze(ruleContext);
    }),
  );

  return buildReport({
    profile: policy.profile,
    policy,
    findings,
    coverage,
    context,
    examinedNodeIds,
    ruleContext,
  });
}

/**
 * Whether the run examined anything this rule's group applies to.
 *
 * Without the gate, a text rule would run over a document whose text
 * acquisition failed and report findings against text it could not read.
 */
function ruleRuns(rule: DeterministicRule, examinedScopes: readonly ScopeKind[]): boolean {
  return GROUP_SCOPES[rule.group].some((scope) => examinedScopes.includes(scope));
}

/**
 * Keep only the findings the deterministic report may carry.
 *
 * The narrowing is a parse, not a cast: `asDeterministicFinding` re-validates
 * each finding, so a rule that somehow produced a semantic or consistency
 * finding has it dropped instead of typed into a report that says it cannot
 * carry one. Spec §27's second gate is enforced by the boundary, not by a
 * comment.
 */
function narrowAll(findings: readonly Finding[]): DeterministicFinding[] {
  return findings
    .map((finding) => asDeterministicFinding(finding))
    .filter((finding): finding is DeterministicFinding => finding !== null);
}

function resolveExaminedNodeIds(
  nodes: readonly DocumentNode[],
  supplied: readonly string[] | undefined,
): string[] {
  if (supplied === undefined) {
    return nodes.map((node) => node.nodeId);
  }
  // Ids the host no longer has are dropped rather than trusted. Carrying one
  // forward would make `examinedScopes` claim a node this run never looked at.
  const present = new Set(nodes.map((node) => node.nodeId));
  return supplied.filter((nodeId) => present.has(nodeId));
}

function assertDeterministicProfile(profile: StyleProfile): void {
  if (profile.kind !== "deterministic") {
    throw new Error(
      `runDeterministicReview requires a deterministic profile; "${profile.kind}" belongs to Semantic Review`,
    );
  }
}

function buildReport(input: {
  profile: StyleProfile;
  policy: ResolvedPolicy;
  findings: DeterministicFinding[];
  coverage: ReturnType<typeof buildDeterministicCoverage>;
  context: DeterministicReviewOptions["context"];
  examinedNodeIds?: readonly string[];
  ruleContext?: DeterministicRuleContext;
}): DeterministicReviewReport {
  const protectedNodeIds = new Set(
    input.context.nodes.filter((node) => !node.includedInGovernance).map((node) => node.nodeId),
  );
  const identity = input.context.identity;
  return DeterministicReviewReportSchema.parse({
    reviewType: "deterministic",
    documentIdentity: {
      documentId: identity.documentId,
      documentVersion: identity.documentVersion,
      contentHash: identity.contentHash,
      structuralHash: identity.structuralHash,
    },
    profileId: input.profile.id,
    profileRevision: input.profile.revision,
    findings: input.findings,
    groups: groupFindings(input.findings, protectedNodeIds),
    coverage: input.coverage,
    summary: summarize(input.findings),
  });
}

/**
 * Re-exported so a caller needs one import rather than two.
 *
 * The type lives in `contracts.ts` because that is where the report is defined;
 * re-exporting it here is convenience, not a second definition. A caller that
 * imported it from here and from contracts would get the same type either way.
 */
export type { DeterministicReviewReport } from "./contracts";
