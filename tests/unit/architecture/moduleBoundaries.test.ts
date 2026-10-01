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
  it("refuses a provider import inside the preservation validator", async () => {
    // The validator's whole claim is that it runs before any provider is
    // consulted, and must keep working when none is configured. A scope no test
    // exercises is a scope that can be deleted without anything going red, which
    // is exactly what happened to the deterministic scope before this file
    // existed.
    const messages = await boundaryViolations(
      "src/analysis/semantic/preservationValidator.ts",
      'import { registry } from "../../ai/providers";\nexport const x = registry;\n',
    );
    expect(messages.join(" ")).toMatch(/must stay local and offline/);
  });

  it("refuses a Word import inside the preservation validator", async () => {
    // A validator that could read the document it is judging a change to would
    // be judging it against something other than the text it was given.
    const messages = await boundaryViolations(
      "src/analysis/semantic/protectedFacts.ts",
      'import { getDocumentSnapshot } from "../../word/documentReader";\nexport const x = getDocumentSnapshot;\n',
    );
    expect(messages.join(" ")).toMatch(/must stay local and offline/);
  });

  it("allows the validator to import its own siblings", async () => {
    // The scope has to be narrow enough to forbid the network and the host
    // without becoming so narrow that the module cannot be written.
    const messages = await boundaryViolations(
      "src/analysis/semantic/preservationValidator.ts",
      'import { extractProtectedFacts } from "./protectedFacts";\nexport const x = extractProtectedFacts;\n',
    );
    expect(messages).toEqual([]);
  });

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

  /*
   * The bare-directory form of every restricted import, in one table.
   *
   * Each scope in `eslint.config.mjs` lists a bare form (`"../../word"`)
   * alongside its subpath form (`"../../word/documentReader"`) precisely because
   * a directory import resolves through the directory's index to the same module
   * and a subpath-only glob would not match it. That reasoning is stated in the
   * config, and stating it is not the same as checking it: a scope listing only
   * subpaths looks identical in review and is a hole exactly where a boundary is
   * easiest to cross.
   *
   * So this table is the mechanical half of the claim. Removing any one bare
   * pattern from the config fails the case that names it, and the failure says
   * which boundary lost its guard rather than that "no violations" — the
   * outcome a project with no restrictions also produces.
   *
   * Grouped by the scope that owns the restriction, and the whole group is
   * exercised for each restricted directory it names.
   */
  const BARE_DIRECTORY_CASES: readonly {
    /** Where the probe is linted, so the scope under `src/` selects. */
    filePath: string;
    /** The import as written, including the bare directory. */
    specifier: string;
    /** The message the scope is expected to produce. */
    message: RegExp;
  }[] = [
    // core/domain may import only zod and shared/utils.
    ...["../word", "../ai", "../taskpane", "../commands"].map((specifier) => ({
      filePath: "src/core/domain/probe.ts",
      specifier,
      message: /core\/domain must stay Office-free/,
    })),
    // rules/ and formatting/ are the two deterministic engines.
    ...["../ai", "../word", "../taskpane", "../commands"].flatMap((specifier) => [
      { filePath: "src/rules/probe.ts", specifier, message: /rules\/ must stay deterministic/ },
      {
        filePath: "src/formatting/probe.ts",
        specifier,
        message: /formatting\/ must stay deterministic/,
      },
    ]),
    // changes/ is pure: no analysis, no rules, no UI, no Word.
    ...[
      "../analysis",
      "../rules",
      "../formatting",
      "../style",
      "../ai",
      "../word",
      "../taskpane",
      "../commands",
    ].map((specifier) => ({
      filePath: "src/changes/probe.ts",
      specifier,
      message: /changes\/ must stay pure/,
    })),
    // The deterministic engine, including the orchestrator and the planner.
    ...[
      "../../ai",
      "../../word",
      "../../taskpane",
      "../../commands",
      "../../reformat",
      "../../changes",
    ].map((specifier) => ({
      filePath: "src/analysis/deterministic/probe.ts",
      specifier,
      message: /must stay deterministic/,
    })),
    // The one sanctioned non-deterministic engine (ADR-0052).
    ...["../../word", "../../taskpane", "../../commands", "../../reformat", "../../changes"].map(
      (specifier) => ({
        filePath: "src/analysis/consistency/probe.ts",
        specifier,
        message: /analysis\/consistency\/ must not reach/,
      }),
    ),
    // The preservation validator, which has to be usable with no provider at all.
    // Probed at a real filename rather than at `probe.ts`: the scope names the
    // three files individually and deliberately does not cover the directory,
    // because P4 puts a non-deterministic engine in the same directory and a
    // directory-wide scope would make that engine unpurgable.
    ...["../../ai", "../../word", "../../taskpane", "../../commands", "../../reformat"].map(
      (specifier) => ({
        filePath: "src/analysis/semantic/preservationValidator.ts",
        specifier,
        message: /must stay local and offline/,
      }),
    ),
    // word/ must not reach the consistency engine at all.
    {
      filePath: "src/word/probe.ts",
      specifier: "../analysis/consistency",
      message: /must not call the consistency engine/,
    },
  ];

  it.each(BARE_DIRECTORY_CASES)(
    "refuses a bare directory import at $filePath: $specifier",
    async ({ filePath, specifier, message }) => {
      const messages = await boundaryViolations(
        filePath,
        `import { x } from "${specifier}";\nexport const y = x;\n`,
      );
      expect(messages.join(" ")).toMatch(message);
    },
  );

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
