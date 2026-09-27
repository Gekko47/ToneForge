/**
 * The open-findings summary the Document Governance header shows.
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

export interface OpenFindingsSummary {
  /** Findings the checker believes must be fixed. */
  mandatory: number;
  /** Findings worth fixing that the checker will not refuse over. */
  advisory: number;
  /** Informational notes, which are neither of the above. */
  informational: number;
  total: number;
}

const EMPTY: OpenFindingsSummary = {
  mandatory: 0,
  advisory: 0,
  informational: 0,
  total: 0,
};

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
    const next = { ...summary, total: summary.total + 1 };
    if (finding.severity === "error") return { ...next, mandatory: next.mandatory + 1 };
    if (finding.severity === "warning") return { ...next, advisory: next.advisory + 1 };
    return { ...next, informational: next.informational + 1 };
  }, EMPTY);
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
