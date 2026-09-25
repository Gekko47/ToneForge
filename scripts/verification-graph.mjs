/**
 * Canonical ordered verification graph for local, CI, and release automation.
 * The human Word-host evidence gate is separate and intentionally blocks
 * release even when every deterministic graph stage passes.
 */
import { execSync } from "node:child_process";

export const VERIFICATION_GRAPH_NAME = "toneforge-repository-v1";

export const VERIFICATION_GRAPH = Object.freeze([
  Object.freeze({ name: "typecheck", command: "npm run typecheck" }),
  Object.freeze({ name: "lint", command: "npm run lint" }),
  Object.freeze({ name: "format", command: "npm run format" }),
  Object.freeze({ name: "secret-scan", command: "npm run secrets:scan" }),
  Object.freeze({ name: "docs", command: "npm run docs:validate" }),
  Object.freeze({ name: "skills", command: "npm run skills:validate" }),
  Object.freeze({ name: "test", command: "npm run test" }),
  Object.freeze({ name: "coverage", command: "npm run test:coverage" }),
  Object.freeze({ name: "build-artifacts", command: "npm run build:check" }),
  Object.freeze({ name: "built-secret-scan", command: "npm run secrets:verify-build" }),
  Object.freeze({ name: "manifest", command: "npm run validate" }),
  Object.freeze({ name: "package", command: "npm run release:package" }),
  Object.freeze({ name: "package-check", command: "npm run release:package:check" }),
]);

export function runVerificationGraph(stages = VERIFICATION_GRAPH) {
  const failed = [];
  for (const stage of stages) {
    console.log(`[${VERIFICATION_GRAPH_NAME}] running: ${stage.name}`);
    try {
      execSync(stage.command, { stdio: "inherit" });
      console.log(`[${VERIFICATION_GRAPH_NAME}] PASS: ${stage.name}`);
    } catch (error) {
      console.error(`[${VERIFICATION_GRAPH_NAME}] FAIL: ${stage.name}`);
      failed.push(stage.name);
    }
  }
  if (failed.length > 0) {
    throw new Error(`${VERIFICATION_GRAPH_NAME} failed: ${failed.join(", ")}`);
  }
  console.log(`[${VERIFICATION_GRAPH_NAME}] all stages passed.`);
}
