#!/usr/bin/env node
/**
 * CLI for the generated host verification dashboard.
 *
 * Writes both a machine-readable JSON artifact and a human-readable Markdown
 * report. The JSON lives under build/ so it is a derived artifact and never a
 * source file that can drift from the document it summarizes.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildHostMatrixDashboard, renderHostMatrixDashboard } from "./host-matrix.mjs";

const SOURCE = join("docs", "manual-verification.md");
const JSON_OUTPUT = join("build", "verification", "host-matrix.json");
const MARKDOWN_OUTPUT = join("build", "verification", "host-matrix.md");

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
  console.log(`[host-matrix] wrote: ${path}`);
}

function main() {
  const markdown = readFileSync(SOURCE, "utf8");
  const dashboard = buildHostMatrixDashboard(markdown);
  write(JSON_OUTPUT, `${JSON.stringify(dashboard, null, 2)}\n`);
  write(MARKDOWN_OUTPUT, renderHostMatrixDashboard(dashboard));

  if (dashboard.evidenceDate === null) {
    console.warn("[host-matrix] WARNING: no dated evidence section found.");
  } else if (dashboard.staleEvidence) {
    console.warn(
      `[host-matrix] WARNING: evidence is ${dashboard.evidenceAgeDays} days old (threshold ${dashboard.stalenessThresholdDays}).`,
    );
  }
  console.log(
    `[host-matrix] ${dashboard.totals.hosts} hosts, ${dashboard.totals.passing} fully passing.`,
  );
}

main();
