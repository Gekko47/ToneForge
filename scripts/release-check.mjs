/**
 * Release readiness check.
 * Verifies the Stage 28 gate before tagging a release.
 */
import { readFileSync } from "node:fs";

function main() {
  const errors = [];

  // 1. project-state.md must not have any FAIL or BLOCKED for hard-gate stages
  const state = readFileSync(new URL("../docs/project-state.md", import.meta.url), "utf-8");
  const hardGateStages = ["01", "18", "27", "28"];
  for (const stage of hardGateStages) {
    const line = state.split("\n").find((l) => l.startsWith(`| ${stage} `));
    if (line && /FAIL|BLOCKED/.test(line)) {
      errors.push(`Hard-gate stage ${stage} is FAIL/BLOCKED`);
    }
  }

  // 2. manual-verification.md must be complete
  const manual = readFileSync(new URL("../docs/manual-verification.md", import.meta.url), "utf-8");
  if (manual.includes("⬜") || manual.includes("PENDING")) {
    errors.push("Manual verification (Stage 27) is not complete");
  }

  if (errors.length > 0) {
    console.error("Release check failed:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log("Release check passed.");
}

main();
