/**
 * Canonical ordered verification graph for local, CI, and release automation.
 * The human Word-host evidence gate is separate and intentionally blocks
 * release even when every deterministic graph stage passes.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const VERIFICATION_GRAPH_NAME = "toneforge-repository-v1";

/**
 * Where a stage's failure actually lives.
 *
 * This exists so a failing run says something actionable instead of just
 * "something failed". A `repository-code` failure is ours to fix; a
 * `dependency-install` failure usually means the registry or the lockfile
 * moved under us, not the code; `external-evidence` is a gate no amount of
 * local automation can satisfy and must never be quietly reported as passing.
 */
export const STAGE_OWNERSHIP = Object.freeze({
  /** Code, configuration, or tests in this repository. Fixable here. */
  "repository-code": "repository-code",
  /** Package installation, registry reachability, or lockfile drift. */
  "dependency-install": "dependency-install",
  /** Producing and inspecting dist/ and the staged release package. */
  "build-package": "build-package",
  /** A human gate in a real Word host. Not automatable, never self-certifying. */
  "external-evidence": "external-evidence",
});

const STAGE_DEFINITIONS = [
  { name: "typecheck", command: "npm run typecheck", owner: "repository-code" },
  { name: "lint", command: "npm run lint", owner: "repository-code" },
  { name: "format", command: "npm run format", owner: "repository-code" },
  { name: "secret-scan", command: "npm run secrets:scan", owner: "repository-code" },
  { name: "docs", command: "npm run docs:validate", owner: "repository-code" },
  { name: "skills", command: "npm run skills:validate", owner: "repository-code" },
  { name: "test", command: "npm run test", owner: "repository-code" },
  { name: "coverage", command: "npm run test:coverage", owner: "repository-code" },
  { name: "build-artifacts", command: "npm run build:check", owner: "build-package" },
  { name: "built-secret-scan", command: "npm run secrets:verify-build", owner: "build-package" },
  { name: "manifest", command: "npm run validate", owner: "repository-code" },
  { name: "package", command: "npm run release:package", owner: "build-package" },
  { name: "package-check", command: "npm run release:package:check", owner: "build-package" },
  // Recorded, never executed. It is in the summary so a reader can see that
  // the host gate exists and is still open, instead of inferring it from a
  // silent absence.
  { name: "word-host-evidence", command: null, owner: "external-evidence" },
];

export const VERIFICATION_GRAPH = Object.freeze(
  STAGE_DEFINITIONS.filter((stage) => stage.command !== null).map((stage) =>
    Object.freeze({ name: stage.name, command: stage.command }),
  ),
);

/** The gate a passing run still has not satisfied. */
export const EXTERNAL_EVIDENCE_STAGE = Object.freeze(
  STAGE_DEFINITIONS.find((stage) => stage.owner === "external-evidence"),
);

export const VERIFICATION_SUMMARY_PATH = join("build", "verification", "summary.json");

/**
 * Build the machine-readable summary.
 *
 * Pure so it can be unit tested without spawning a process. A stage that threw
 * is recorded as failed even when a later stage passed, and an external-evidence
 * gate is always reported as pending: it has no result because it was never run.
 */
export function buildVerificationSummary({ results, startedAt, finishedAt }) {
  const stages = STAGE_DEFINITIONS.map((stage) => {
    // An external-evidence stage is never read from `results` at all. Deriving
    // its status from a caller-supplied map would let a pass be manufactured
    // for the one gate that only a human in a real Word host can satisfy.
    const external = stage.owner === "external-evidence";
    const result = external ? undefined : results[stage.name];
    const status = external
      ? "pending"
      : result === undefined
        ? "pending"
        : result
          ? "passed"
          : "failed";
    return {
      name: stage.name,
      command: stage.command,
      owner: stage.owner,
      status,
      ...(external
        ? { note: "Satisfied only by a human in a real Word host; never automated." }
        : {}),
    };
  });
  const failed = stages.filter((stage) => stage.status === "failed");
  const pending = stages.filter((stage) => stage.status === "pending");
  // A pending stage is only an *external* gate when a human owns it. An
  // automated stage that never ran is missing work, not an open gate, and
  // listing it among the external gates would tell a reader no local
  // automation is outstanding.
  const openExternal = pending.filter((stage) => stage.owner === "external-evidence");
  const pendingAutomated = pending.filter((stage) => stage.owner !== "external-evidence");
  return {
    graph: VERIFICATION_GRAPH_NAME,
    version: 1,
    startedAt,
    finishedAt,
    // An automated stage that did not run is not a pass. Reporting `ok` for a
    // run that skipped local verification would be a green summary for a run
    // that verified nothing.
    ok: failed.length === 0 && pendingAutomated.length === 0,
    stages,
    failureOwners: [...new Set(failed.map((stage) => stage.owner))],
    openExternalGates: openExternal.map((stage) => stage.name),
  };
}

function writeSummary(summary) {
  mkdirSync(dirname(VERIFICATION_SUMMARY_PATH), { recursive: true });
  writeFileSync(VERIFICATION_SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`[${VERIFICATION_GRAPH_NAME}] summary: ${VERIFICATION_SUMMARY_PATH}`);
}

export function runVerificationGraph(stages = VERIFICATION_GRAPH) {
  const startedAt = new Date().toISOString();
  const results = {};
  for (const stage of stages) {
    console.log(`[${VERIFICATION_GRAPH_NAME}] running: ${stage.name}`);
    try {
      execSync(stage.command, { stdio: "inherit" });
      results[stage.name] = true;
      console.log(`[${VERIFICATION_GRAPH_NAME}] PASS: ${stage.name}`);
    } catch (error) {
      // The graph continues after a failure so one broken stage still reports
      // the state of every other stage. `build:check` depends on a build, so
      // a typecheck failure cascades; recording it as its own result is still
      // the honest report.
      console.error(`[${VERIFICATION_GRAPH_NAME}] FAIL: ${stage.name}`);
      results[stage.name] = false;
    }
  }
  const summary = buildVerificationSummary({
    results,
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  writeSummary(summary);
  // The gate is the summary, not this run's local failure list. `ok` is also
  // false when an automated stage never ran, and a run that skipped local
  // verification must not report success just because nothing it ran failed.
  if (!summary.ok) {
    const failed = summary.stages
      .filter((stage) => stage.status === "failed")
      .map((stage) => stage.name);
    const notRun = summary.stages
      .filter((stage) => stage.status === "pending" && stage.owner !== "external-evidence")
      .map((stage) => `${stage.name} (did not run)`);
    throw new Error(`${VERIFICATION_GRAPH_NAME} failed: ${[...failed, ...notRun].join(", ")}`);
  }
  console.log(`[${VERIFICATION_GRAPH_NAME}] all stages passed.`);
  console.log(
    `[${VERIFICATION_GRAPH_NAME}] open external gates: ${summary.openExternalGates.join(", ")}`,
  );
}
