/**
 * Unified findings engine.
 *
 * Merges `Finding` arrays from deterministic, formatting, and semantic
 * engines into a single sorted, deduplicated list. Pure: no Office, no LLM,
 * no UI imports — fully unit-testable.
 *
 * Boundary rule: this module may only import from `core/domain`, `rules`,
 * `formatting`, `ai/providers`, and `shared/utils` (see docs/architecture.md).
 */

import type { Finding, Range, Severity } from "../core/domain/Finding";
import { FindingSchema } from "../core/domain/Finding";

export interface UnifyOptions {
  deterministic?: Finding[];
  formatting?: Finding[];
  semantic?: Finding[];
}

const SEVERITY_RANK: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

interface IndexedFinding {
  finding: Finding;
  sourceIndex: number;
}

function rangeKey(range: Range): string {
  return `${range.start}:${range.end}:${range.unit}`;
}

function rangeLength(range: Range): number {
  return range.end - range.start;
}

function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity];
}

function compareIndexedFindings(left: IndexedFinding, right: IndexedFinding): number {
  const byStart = left.finding.range.start - right.finding.range.start;
  if (byStart !== 0) return byStart;
  const byEnd = left.finding.range.end - right.finding.range.end;
  if (byEnd !== 0) return byEnd;
  const bySeverity = severityRank(left.finding.severity) - severityRank(right.finding.severity);
  if (bySeverity !== 0) return bySeverity;
  return left.sourceIndex - right.sourceIndex;
}

function resolveCategory(findings: IndexedFinding[]): IndexedFinding[] {
  const byStart = [...findings].sort((left, right) => {
    const byStart = left.finding.range.start - right.finding.range.start;
    if (byStart !== 0) return byStart;
    return left.finding.range.end - right.finding.range.end;
  });

  const groups: IndexedFinding[][] = [];
  let groupEnd = -1;
  byStart.forEach((candidate) => {
    const current = groups[groups.length - 1];
    if (!current || candidate.finding.range.start >= groupEnd) {
      groups.push([candidate]);
      groupEnd = candidate.finding.range.end;
      return;
    }

    current.push(candidate);
    groupEnd = Math.max(groupEnd, candidate.finding.range.end);
  });

  return groups.map((group) =>
    group.reduce((best, candidate) => {
      const bestLength = rangeLength(best.finding.range);
      const candidateLength = rangeLength(candidate.finding.range);
      if (candidateLength > bestLength) return candidate;
      if (candidateLength < bestLength) return best;

      const bySeverity =
        severityRank(candidate.finding.severity) - severityRank(best.finding.severity);
      if (bySeverity < 0) return candidate;
      if (bySeverity > 0) return best;

      return candidate.sourceIndex < best.sourceIndex ? candidate : best;
    }),
  );
}

/**
 * Merge findings from multiple engines, deduplicate exact duplicates, resolve
 * same-category overlaps, and return a deterministically sorted list.
 *
 * - Exact duplicates (same range, category, and message) are collapsed.
 * - Overlapping findings with different categories are both preserved.
 * - Overlapping findings with the same category are resolved by
 *   longest-match-wins, then severity (error > warning > info), then stable
 *   source order.
 * - Findings that fail `FindingSchema` validation (including invalid ranges)
 *   are silently skipped.
 */
export function unifyFindings(options: UnifyOptions): Finding[] {
  const { deterministic = [], formatting = [], semantic = [] } = options;

  const all: Finding[] = [];
  [...deterministic, ...formatting, ...semantic].forEach((raw) => {
    const result = FindingSchema.safeParse(raw);
    if (result.success) {
      all.push(result.data);
    }
  });

  if (all.length === 0) return [];

  // Deduplicate exact duplicates by range + category + message.
  const seen = new Map<string, Finding>();
  all.forEach((finding) => {
    const key = `${rangeKey(finding.range)}:${finding.category}:${finding.message}`;
    if (!seen.has(key)) {
      seen.set(key, finding);
    }
  });

  const indexed = Array.from(seen.values(), (finding, sourceIndex) => ({
    finding,
    sourceIndex,
  }));
  const byCategoryAndUnit = new Map<string, IndexedFinding[]>();
  indexed.forEach((entry) => {
    const key = `${entry.finding.category}:${entry.finding.range.unit}`;
    const categoryFindings = byCategoryAndUnit.get(key);
    if (categoryFindings) {
      categoryFindings.push(entry);
    } else {
      byCategoryAndUnit.set(key, [entry]);
    }
  });

  const resolved = Array.from(byCategoryAndUnit.values()).flatMap(resolveCategory);
  resolved.sort(compareIndexedFindings);
  return resolved.map(({ finding }) => finding);
}
