/**
 * The coverage verdict — the pane's one compliance claim.
 *
 * The defect these reproduce (audit §17): three verdicts rendered, and
 * "Compliant within checked scope" was not expressible. The missing state was not
 * cosmetic. `Complete` was printed for a run that examined every requested scope
 * and found two hundred problems, and the word a reader takes from that is
 * "nothing to do" — which is the false-compliance claim the whole coverage model
 * was built to prevent.
 */

import { describe, expect, it } from "vitest";
import {
  coverageVerdict,
  verdictDetail,
  verdictLabel,
  type CoverageVerdictInput,
} from "../../../src/taskpane/coverageVerdict";
import { DeterministicCoverageSchema } from "../../../src/analysis/deterministic/contracts";

function coverage(overrides: Record<string, unknown> = {}) {
  return DeterministicCoverageSchema.parse({
    requestedScopes: ["body", "headings"],
    examinedScopes: ["body", "headings"],
    unsupportedScopes: [],
    excludedScopes: [],
    protectedScopes: [],
    textCharactersExamined: 4200,
    paragraphsExamined: 12,
    headingsExamined: 3,
    listsExamined: 0,
    tablesExamined: 0,
    sectionsExamined: 1,
    headersFootersExamined: 0,
    complete: true,
    blockers: [],
    coverageFingerprint: "body,headings|p3|t0|s0|h0",
    ...overrides,
  });
}

const input = (overrides: Partial<CoverageVerdictInput> = {}): CoverageVerdictInput => ({
  coverage: coverage(),
  openFindings: 0,
  ...overrides,
});

describe("coverageVerdict", () => {
  it("states no claim when only the shared report arrived", () => {
    expect(coverageVerdict(input({ coverage: null }))).toBe("unknown");
  });

  it("is incomplete when a mandatory scope was not examined", () => {
    expect(coverageVerdict(input({ coverage: coverage({ complete: false }) }))).toBe("incomplete");
  });

  it("is compliant only when the scope was complete and nothing is open", () => {
    expect(coverageVerdict(input({ openFindings: 0 }))).toBe("compliant");
  });

  /*
   * The defect, as a test.
   *
   * A complete run that found problems is `complete` in the coverage record —
   * that word means "everything requested was examined", and it is true. Reading
   * it as "the document is fine" is the misreading, and it is the one the audit
   * is about.
   */
  it("does not call a complete scan with open findings compliant", () => {
    expect(coverageVerdict(input({ openFindings: 200 }))).toBe("findings-open");
  });

  it("treats a single open finding as open", () => {
    expect(coverageVerdict(input({ openFindings: 1 }))).toBe("findings-open");
  });

  /*
   * Order matters. An incomplete run with findings open is `incomplete`, not
   * `findings-open` — the missing scope is the more important fact, and leading
   * with a count would bury the reason the run cannot speak for the document.
   */
  it("prefers incomplete over findings-open, whatever the finding count", () => {
    expect(
      coverageVerdict(input({ coverage: coverage({ complete: false }), openFindings: 200 })),
    ).toBe("incomplete");
  });

  it("reports unknown even with findings open, because no scope claim exists", () => {
    expect(coverageVerdict(input({ coverage: null, openFindings: 12 }))).toBe("unknown");
  });
});

describe("verdictLabel", () => {
  it("names the compliant verdict by its checked scope", () => {
    expect(verdictLabel("compliant")).toBe("Compliant within checked scope");
  });

  it("does not print bare 'Complete' for a run that is only a coverage claim", () => {
    // "Complete" was the old label, and a reader takes it as "nothing to do".
    expect(verdictLabel("findings-open")).not.toBe("Complete");
    expect(verdictLabel("compliant")).not.toBe("Complete");
  });

  it("has a distinct label for every verdict", () => {
    const labels = (["unknown", "incomplete", "compliant", "findings-open"] as const).map(
      verdictLabel,
    );
    expect(new Set(labels).size).toBe(4);
  });
});

describe("verdictDetail", () => {
  it("bounds the compliant claim by the scopes actually examined", () => {
    const text = verdictDetail("compliant", input());
    expect(text).toContain("body, headings");
    expect(text).toContain("not checked");
  });

  it("says plainly that an incomplete run cannot speak for the document", () => {
    const text = verdictDetail("incomplete", input({ coverage: coverage({ complete: false }) }));
    expect(text).toContain("cannot speak for the document");
  });

  it("counts the open findings, in the singular for one", () => {
    expect(verdictDetail("findings-open", input({ openFindings: 1 }))).toContain("1 finding is");
    expect(verdictDetail("findings-open", input({ openFindings: 4 }))).toContain("4 findings are");
  });

  it("names no verdict when none is available", () => {
    expect(verdictDetail("unknown", input({ coverage: null }))).toContain("cannot say");
  });

  /*
   * Every branch has to say its own limit. A detail line that only explains the
   * good case teaches the reader that the word means "the document is fine".
   */
  it("states a limit in every branch", () => {
    const branches = [
      verdictDetail("unknown", input({ coverage: null })),
      verdictDetail("incomplete", input({ coverage: coverage({ complete: false }) })),
      verdictDetail("compliant", input()),
      verdictDetail("findings-open", input({ openFindings: 2 })),
    ];
    branches.forEach((text) => expect(text.length).toBeGreaterThan(40));
    expect(branches.filter((text) => /not checked|cannot|no claim/.test(text))).toHaveLength(4);
  });
});
