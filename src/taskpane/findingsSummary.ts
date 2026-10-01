/**
 * The open-findings summary the Deterministic Review header shows.
 *
 * Severity is the *consequence*, not the label: a finding the checker calls
 * `error` is one it believes must be fixed, and calling that "high severity"
 * in a summary the user reads in half a second would soften it back into
 * advice. The three buckets are the ones the deterministic rules already
 * distinguish, so this adds no new judgement of its own.
 *
 * Ignored findings are excluded *before* counting, not filtered out of the
 * total afterwards. A user who ignored twenty findings and sees "0 open
 * findings" is being told the document is clean, which is the one thing the
 * count must never say: it means they are no longer being shown, not that
 * they were resolved.
 */

import type { Finding } from "../core/domain/Finding";

/**
 * The three groups spec §22 shows as separate cards.
 *
 * `language` is the text and terminology rules, `formatting` the paragraph and
 * style comparisons, `structure` the document-shape rules. The bucketing is
 * derived rather than stored, because a finding's category is the identity and a
 * second label on it would be a second thing to keep in step.
 */
export interface CategoryGroupCounts {
  language: number;
  formatting: number;
  structure: number;
}

export interface OpenFindingsSummary {
  /** Findings the checker believes must be fixed. */
  mandatory: number;
  /** Findings worth fixing that the checker will not refuse over. */
  advisory: number;
  /** Informational notes, which are neither of the above. */
  informational: number;
  total: number;
  /**
   * The same open findings, counted by the review group they belong to.
   *
   * Severity and group answer different questions — "how bad" against "what
   * kind" — and a reader deciding where to start needs the second one. Counting
   * them here rather than in the header means the two summaries cannot be taken
   * over different lists, which is the same defect the severity counts were
   * written to avoid.
   */
  byGroup: CategoryGroupCounts;
}

const EMPTY: OpenFindingsSummary = {
  mandatory: 0,
  advisory: 0,
  informational: 0,
  total: 0,
  byGroup: { language: 0, formatting: 0, structure: 0 },
};

/**
 * Which review group a finding belongs to.
 *
 * `structure` takes the three structural formatting categories first and the
 * language group by default, so a `formatting.emptyHeading` is a structure
 * finding rather than one of several thousand formatting ones — a reader
 * triaging a long document wants the twenty structural problems separated from
 * the four hundred spacing ones, and the reverse sort buries them.
 */
export function groupOf(finding: Finding): keyof CategoryGroupCounts {
  if (finding.kind !== "formatting") return "language";
  return finding.category.startsWith("formatting.heading") ||
    finding.category.startsWith("formatting.empty") ||
    finding.category.startsWith("formatting.unknown")
    ? "structure"
    : "formatting";
}

/**
 * Count open findings by severity.
 *
 * `ignored` is a predicate rather than a set of ids so the caller owns the
 * identity question. Findings carry a uuid that changes every scan, so a
 * caller that compared ids would find nothing ignored after a rescan; the
 * fingerprint is what survives one.
 */
export function summarizeOpenFindings(
  findings: readonly Finding[],
  isIgnored: (finding: Finding) => boolean = () => false,
): OpenFindingsSummary {
  return findings.reduce<OpenFindingsSummary>((summary, finding) => {
    if (isIgnored(finding)) return summary;
    const group = groupOf(finding);
    const next = {
      ...summary,
      total: summary.total + 1,
      byGroup: { ...summary.byGroup, [group]: summary.byGroup[group] + 1 },
    };
    if (finding.severity === "error") return { ...next, mandatory: next.mandatory + 1 };
    if (finding.severity === "warning") return { ...next, advisory: next.advisory + 1 };
    return { ...next, informational: next.informational + 1 };
  }, EMPTY);
}

/**
 * Render the per-group counts as a short sentence.
 *
 * Only the groups that have findings, and in a fixed order, so the line does not
 * reflow as a user works through the list. A group with nothing in it is left
 * out rather than shown as a zero: "Structure: 0" on every document trains the
 * reader to skip the line.
 */
export function describeCategoryGroups(counts: CategoryGroupCounts): string {
  const parts: string[] = [];
  if (counts.language > 0) parts.push(`${counts.language} language`);
  if (counts.formatting > 0) parts.push(`${counts.formatting} formatting`);
  if (counts.structure > 0) parts.push(`${counts.structure} structure`);
  return parts.length === 0 ? "" : parts.join(", ");
}

/**
 * Render the summary as the sentence the header shows.
 *
 * Says "No open findings" only when there are none *open*, and never claims
 * the document is clean — a clean claim would need the coverage report to
 * agree, and the summary is not allowed to consult it. A partial analysis
 * with no findings is "no open findings in the text checked", which is a
 * narrower and truer statement.
 */
export function describeOpenFindings(summary: OpenFindingsSummary): string {
  if (summary.total === 0) return "No open findings";
  const parts = [`Mandatory: ${summary.mandatory} open finding(s)`];
  parts.push(`Advisory: ${summary.advisory} open finding(s)`);
  if (summary.informational > 0) {
    parts.push(`Informational: ${summary.informational} open finding(s)`);
  }
  return parts.join(" / ");
}
