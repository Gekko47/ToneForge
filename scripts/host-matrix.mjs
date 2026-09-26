/**
 * Host-matrix dashboard generation (Phase 4).
 *
 * `docs/manual-verification.md` is the canonical record of what a human has
 * actually observed in a real Word host. That makes it the right source for a
 * release dashboard, and also its main risk: a table that nobody updates still
 * *looks* authoritative. This module therefore does two things beyond
 * transposing the table.
 *
 * 1. **Freshness.** Evidence older than the staleness window is marked stale.
 *    A WebView2 build number is a moving target, and last quarter's probe says
 *    nothing about the build shipping this quarter.
 * 2. **Silence.** A cell that is blank, "—", "TBD", or "Not recorded" is
 *    reported as unknown rather than being quietly dropped, so "we have three
 *    hosts" cannot become "we have three passing hosts".
 *
 * Every status is one of `pass`, `partial`, `fail`, `pending`, `unknown`. The
 * mapping is deliberately conservative: anything the document does not state
 * explicitly as a pass is not a pass.
 */

/** How old evidence may be before it is reported as stale. */
export const EVIDENCE_STALENESS_DAYS = 90;

export const HOST_MATRIX_STATUSES = Object.freeze([
  "pass",
  "partial",
  "fail",
  "pending",
  "unknown",
]);

/** Descriptive columns: what the host was, not how it performed. */
export const HOST_MATRIX_DESCRIPTORS = Object.freeze(["Host", "Version", "Browser/engine"]);

/**
 * Verdict columns: the only cells that can be a pass or a failure.
 *
 * `Version` and `Browser/engine` are deliberately excluded. "Edge WebView2
 * 153" is a build number, not a verdict, and reducing it to a pass/unknown
 * status would both lose the value and imply it was ever assessed.
 */
export const HOST_MATRIX_CHECKS = Object.freeze(["Sideload", "Task pane", "Probe"]);

/** Statuses a release would be willing to call green. */
export const PASSING_STATUSES = Object.freeze(["pass"]);

const STALE_AFTER_MS = EVIDENCE_STALENESS_DAYS * 24 * 60 * 60 * 1000;

function normalizeStatus(raw) {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "pass" || value === "passed" || value === "passing") return "pass";
  if (value === "partial") return "partial";
  if (value === "fail" || value === "failed" || value === "failure" || value === "blocked") {
    return "fail";
  }
  if (value === "pending" || value === "in progress" || value === "in-progress") return "pending";
  // A dash, a blank, "TBD", "unknown", "not recorded", or anything the document
  // does not define all mean the same thing: nobody has observed this.
  return "unknown";
}

/** Whether a cell records a real observation at all. */
export function hasObservation(raw) {
  const value = (raw ?? "").trim().toLowerCase();
  if (value.length === 0) return false;
  return !["-", "--", "—", "–", "n/a", "na", "tbd", "tbc", "?", "unknown"].includes(value);
}

function splitRow(line) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()));
}

/**
 * Find the host-matrix table.
 *
 * Scoped to the `## Host matrix` section so an unrelated table later in the
 * document cannot be mistaken for it.
 */
export function extractHostMatrix(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^##\s+Host matrix\s*$/i.test(line.trim()));
  if (headingIndex === -1) {
    throw new Error("docs/manual-verification.md has no '## Host matrix' section");
  }
  const rows = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^##\s+/.test(line)) break;
    if (!line.trim().startsWith("|")) {
      // A blank line ends the table but not the section.
      if (rows.length > 0) break;
      continue;
    }
    const cells = splitRow(line);
    if (isSeparatorRow(cells)) continue;
    if (rows.length === 0) {
      rows.push(cells);
      continue;
    }
    rows.push(cells);
  }
  if (rows.length < 2) {
    throw new Error("docs/manual-verification.md '## Host matrix' section has no data rows");
  }
  return { header: rows[0], dataRows: rows.slice(1) };
}

/** The most recent `## ... evidence — YYYY-MM-DD` date in the document. */
export function extractEvidenceDate(markdown) {
  const pattern = /^##\s+.*evidence\s+[—-]\s*(\d{4}-\d{2}-\d{2})\s*$/gim;
  let latest = null;
  let match = pattern.exec(markdown);
  while (match !== null) {
    const value = match[1];
    if (latest === null || value > latest) latest = value;
    match = pattern.exec(markdown);
  }
  return latest;
}

/**
 * Build the structured dashboard.
 *
 * Pure: the caller supplies the markdown and the clock, so the staleness rule
 * is testable without waiting ninety days.
 */
export function buildHostMatrixDashboard(markdown, { now = new Date() } = {}) {
  const { header, dataRows } = extractHostMatrix(markdown);
  const evidenceDate = extractEvidenceDate(markdown);
  const ageDays = evidenceDate === null ? null : daysBetween(evidenceDate, now);
  const stale = ageDays !== null && ageDays > EVIDENCE_STALENESS_DAYS;

  const rows = dataRows.map((cells) => {
    const record = {};
    header.forEach((column, index) => {
      record[column] = cells[index] ?? "";
    });
    const checks = HOST_MATRIX_CHECKS.map((column) => ({
      column,
      raw: record[column] ?? "",
      status: normalizeStatus(record[column]),
      observed: hasObservation(record[column]),
    }));
    return {
      host: record["Host"] ?? "(unnamed host)",
      version: record["Version"] ?? "",
      engine: record["Browser/engine"] ?? "",
      checks,
      statuses: checks.map((check) => check.status),
      evidence: record["Current evidence"] ?? "",
      // A row is only green when every named check is a real pass. A host with
      // two passes and one unknown is partial, not passing.
      overall: summarizeRow(checks),
    };
  });

  return {
    generatedFrom: "docs/manual-verification.md",
    descriptors: [...HOST_MATRIX_DESCRIPTORS],
    checks: [...HOST_MATRIX_CHECKS],
    evidenceDate,
    evidenceAgeDays: ageDays,
    staleEvidence: stale,
    stalenessThresholdDays: EVIDENCE_STALENESS_DAYS,
    rows,
    totals: tally(rows),
    releaseReady: false,
    releaseNote:
      "Never release-ready from this file alone. The human Word-host gate is separate and must be satisfied explicitly.",
  };
}

function summarizeRow(checks) {
  const statuses = checks.map((check) => check.status);
  if (statuses.length > 0 && statuses.every((status) => status === "pass")) return "pass";
  if (statuses.includes("fail")) return "fail";
  if (statuses.every((status) => status === "unknown")) return "unknown";
  if (statuses.some((status) => status === "pass" || status === "partial")) return "partial";
  return "pending";
}

function tally(rows) {
  const byOverall = {};
  for (const row of rows) {
    byOverall[row.overall] = (byOverall[row.overall] ?? 0) + 1;
  }
  return {
    hosts: rows.length,
    byOverall,
    passing: rows.filter((row) => PASSING_STATUSES.includes(row.overall)).length,
  };
}

function daysBetween(isoDate, now) {
  const parsed = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return null;
  return Math.floor((now.getTime() - parsed) / (24 * 60 * 60 * 1000));
}

/** Render the dashboard as a Markdown table for a report or a PR comment. */
export function renderHostMatrixDashboard(dashboard) {
  // The engine and version stay verbatim. They are descriptors, so collapsing
  // them to a status would throw away information a reader needs and imply an
  // assessment that was never made.
  const header = `| Host | Version | Browser/engine | ${dashboard.checks.join(" | ")} | Overall |`;
  const divider = `| --- | --- | --- | ${dashboard.checks.map(() => "---").join(" | ")} | --- |`;
  const body = dashboard.rows.map((row) => {
    const cells = row.checks.map((check) => check.status);
    return `| ${row.host} | ${row.version} | ${row.engine} | ${cells.join(" | ")} | ${row.overall} |`;
  });
  const freshness =
    dashboard.evidenceDate === null
      ? "**No evidence date found.** The host matrix has no dated observation to judge freshness against."
      : dashboard.staleEvidence
        ? `**Evidence is stale.** Last recorded ${dashboard.evidenceDate} (${dashboard.evidenceAgeDays} days ago, threshold ${dashboard.stalenessThresholdDays} days).`
        : `Evidence current as of ${dashboard.evidenceDate} (${dashboard.evidenceAgeDays} days ago).`;
  return [
    "# ToneForge host verification dashboard",
    "",
    "Generated from `docs/manual-verification.md`. Do not edit by hand.",
    "",
    freshness,
    "",
    header,
    divider,
    ...body,
    "",
    `Hosts: ${dashboard.totals.hosts}. Fully passing: ${dashboard.totals.passing}.`,
    "",
    `> ${dashboard.releaseNote}`,
    "",
  ].join("\n");
}
