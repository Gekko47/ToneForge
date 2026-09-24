import type { Change } from "../core/domain/Change";
import type { CoverageReport } from "../core/domain/DocumentSnapshot";
import type { Finding } from "../core/domain/Finding";

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function splitForCsv(value: string): string[] {
  if (value.length <= 240) return [value];
  return [value.slice(0, 240), `…${value.slice(240)}`];
}

export function toRevisionsCsv(
  changes: readonly Change[],
  findings: readonly Finding[],
  coverage: CoverageReport,
): string {
  if (!coverage.complete) throw new Error("Export blocked: FAILED_COVERAGE");
  const findingById = new Map(findings.map((finding) => [finding.id, finding]));
  const rows: string[] = ["before,after"];
  changes.forEach((change) => {
    const finding = change.findingId ? findingById.get(change.findingId) : undefined;
    const before = finding?.actual ?? "";
    const after = finding?.expected ?? (change.payload.text as string | undefined) ?? "";
    const beforeParts = splitForCsv(before);
    const afterParts = splitForCsv(after);
    rows.push(`${csvCell(beforeParts[0] ?? "")},${csvCell(afterParts[0] ?? "")}`);
    if (beforeParts.length > 1) {
      rows.push(`${csvCell(beforeParts[1] ?? "")},${csvCell(afterParts[1] ?? "")}`);
    }
  });
  return rows.join("\n");
}

export function toAuditJson(value: unknown, coverage: CoverageReport): string {
  if (!coverage.complete) throw new Error("Export blocked: FAILED_COVERAGE");
  return JSON.stringify({ value, coverage }, null, 2);
}
