/**
 * Stage verification script.
 * Runs the checks appropriate for the current stage. Exit 0 = PASS.
 */
import { execSync } from "node:child_process";

const checks = [
  { name: "typecheck", cmd: "npm run typecheck" },
  { name: "lint", cmd: "npm run lint" },
  { name: "format", cmd: "npm run format" },
  { name: "secrets", cmd: "npm run secrets:scan" },
  { name: "docs", cmd: "npm run docs:validate" },
  { name: "test", cmd: "npm run test" },
  { name: "build", cmd: "npm run build" },
  { name: "build-artifacts", cmd: "node scripts/check-build-artifacts.mjs" },
  { name: "validate", cmd: "npm run validate" },
  { name: "package", cmd: "npm run release:package" },
];

function main() {
  const failed = [];
  for (const check of checks) {
    try {
      console.log(`[stage-verify] running: ${check.name}`);
      execSync(check.cmd, { stdio: "inherit" });
      console.log(`[stage-verify] PASS: ${check.name}`);
    } catch (err) {
      console.error(`[stage-verify] FAIL: ${check.name}`);
      failed.push(check.name);
    }
  }

  if (failed.length > 0) {
    console.error(`\n[stage-verify] ${failed.length} check(s) failed: ${failed.join(", ")}`);
    process.exit(1);
  }

  console.log("\n[stage-verify] All checks passed.");
}

main();
