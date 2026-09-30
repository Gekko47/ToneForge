/**
 * Spec §27 gate 1: Deterministic Review makes zero LLM calls.
 *
 * The mechanism is an ESLint scope, not a runtime check, and a scope that no
 * test exercises is a scope that can be deleted without anything going red.
 * That is not hypothetical: the deterministic scope permitted `reformat/` and
 * `changes/` until this file existed, so a rule could have reached
 * `word/revisionAdapter` through the orchestrator — with every local change
 * looking correct and no test failing.
 *
 * Each case below lints a synthetic source at a path inside the boundary it is
 * testing, so the project's own flat config decides which block applies.
 * `lintText` is used rather than writing files, because a probe written into
 * `src/` is a probe that a crashed test leaves behind, and a leftover
 * `src/analysis/deterministic/probe.ts` would be indistinguishable from real
 * production code to every tool that reads the directory.
 *
 * A whole-project lint cannot stand in for this: a project with no violations
 * is indistinguishable from a project with no rules.
 */

import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({
    cwd: process.cwd(),
    // The project's own flat config, so this asserts the real scopes rather
    // than a copy of them that could drift.
    overrideConfigFile: "eslint.config.mjs",
  });
});

/** Lint `source` as though it lived at `filePath`, and return boundary errors. */
async function boundaryViolations(filePath: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath, warnIgnored: false });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "no-restricted-imports")
    .map((message) => message.message);
}

describe("the ESLint boundary scopes are live", () => {
  it("refuses a provider import inside the deterministic engine", async () => {
    const messages = await boundaryViolations(
      "src/analysis/deterministic/probe.ts",
      'import { registry } from "../../ai/providers";\nexport const x = registry;\n',
    );
    expect(messages.join(" ")).toMatch(/must stay deterministic/);
  });

  it("refuses the revision adapter inside the deterministic engine", async () => {
    const messages = await boundaryViolations(
      "src/analysis/deterministic/probe.ts",
      'import { applyChangePlan } from "../../word/revisionAdapter";\nexport const x = applyChangePlan;\n',
    );
    expect(messages.join(" ")).toMatch(/must stay deterministic/);
  });

  it("refuses a Word import inside the deterministic engine, by directory", async () => {
    // The bare form is the interesting one: it resolves through the directory's
    // index to the same module, and a subpath-only glob would let it through.
    const messages = await boundaryViolations(
      "src/analysis/deterministic/probe.ts",
      'import { getDocumentSnapshot } from "../../word";\nexport const x = getDocumentSnapshot;\n',
    );
    expect(messages.join(" ")).toMatch(/must stay deterministic/);
  });

  it("refuses the orchestrator inside the deterministic engine", async () => {
    const messages = await boundaryViolations(
      "src/analysis/deterministic/probe.ts",
      'import { reformatDocument } from "../../reformat/orchestrator";\nexport const x = reformatDocument;\n',
    );
    expect(messages.join(" ")).toMatch(/must stay deterministic/);
  });

  it("refuses the planner inside the deterministic engine", async () => {
    const messages = await boundaryViolations(
      "src/analysis/deterministic/probe.ts",
      'import { planChanges } from "../../changes/planner";\nexport const x = planChanges;\n',
    );
    expect(messages.join(" ")).toMatch(/must stay deterministic/);
  });

  it("refuses the task pane inside the deterministic engine", async () => {
    const messages = await boundaryViolations(
      "src/analysis/deterministic/probe.ts",
      'import { Dashboard } from "../../taskpane/pages/Dashboard";\nexport const x = Dashboard;\n',
    );
    expect(messages.join(" ")).toMatch(/must stay deterministic/);
  });

  it("refuses a provider import inside a deterministic rule", async () => {
    const messages = await boundaryViolations(
      "src/rules/probe.ts",
      'import { registry } from "../ai/providers";\nexport const x = registry;\n',
    );
    expect(messages.join(" ")).toMatch(/rules\/ must stay deterministic/);
  });

  it("refuses a Word import inside a formatting engine", async () => {
    const messages = await boundaryViolations(
      "src/formatting/probe.ts",
      'import { getDocumentSnapshot } from "../word/documentReader";\nexport const x = getDocumentSnapshot;\n',
    );
    expect(messages.join(" ")).toMatch(/formatting\/ must stay deterministic/);
  });

  it("refuses a Word import inside the domain model", async () => {
    const messages = await boundaryViolations(
      "src/core/domain/probe.ts",
      'import { getDocumentSnapshot } from "../../word/documentReader";\nexport const x = getDocumentSnapshot;\n',
    );
    expect(messages.join(" ")).toMatch(/core\/domain must stay Office-free/);
  });

  it("refuses the analysis engine inside the planner", async () => {
    const messages = await boundaryViolations(
      "src/changes/probe.ts",
      'import { runDeterministicReview } from "../analysis/deterministic/deterministicReviewEngine";\nexport const x = runDeterministicReview;\n',
    );
    expect(messages.join(" ")).toMatch(/changes\/ must stay pure/);
  });

  it("refuses the rules engine inside the planner, by directory", async () => {
    const messages = await boundaryViolations(
      "src/changes/probe.ts",
      'import { findTypographyIssues } from "../rules";\nexport const x = findTypographyIssues;\n',
    );
    expect(messages.join(" ")).toMatch(/changes\/ must stay pure/);
  });

  it("refuses the revision adapter inside the task pane", async () => {
    const messages = await boundaryViolations(
      "src/taskpane/probe.ts",
      'import { applyChangePlan } from "../word/revisionAdapter";\nexport const x = applyChangePlan;\n',
    );
    expect(messages.join(" ")).toMatch(/must not import revisionAdapter directly/);
  });

  it("refuses the consistency engine from a typing-path module", async () => {
    const messages = await boundaryViolations(
      "src/word/probe.ts",
      'import { checkConsistency } from "../analysis/consistency";\nexport const x = checkConsistency;\n',
    );
    expect(messages.join(" ")).toMatch(/must not call the consistency engine/);
  });

  it("permits the imports each boundary is supposed to allow", async () => {
    expect(
      await boundaryViolations(
        "src/rules/probe.ts",
        'import { FindingSchema } from "../core/domain/Finding";\nexport const x = FindingSchema;\n',
      ),
    ).toEqual([]);
    expect(
      await boundaryViolations(
        "src/analysis/deterministic/probe.ts",
        'import { findTypographyIssues } from "../../rules/typography";\nexport const x = findTypographyIssues;\n',
      ),
    ).toEqual([]);
  });
});
