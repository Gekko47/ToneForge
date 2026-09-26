import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { toRevisionsCsv } from "../../../src/changes/exportAdapter";
import { sampleFinding, sampleNode } from "../../fixtures/sampleDocs";
import { createTestPlan } from "../../fixtures/changePlans";
import { buildCoverage } from "../../../src/analysis/coverage";
import type { Change } from "../../../src/core/domain/Change";
import type { Finding } from "../../../src/core/domain/Finding";

/**
 * A change linked to a finding.
 *
 * The serialiser resolves before/after through `findingId`, so an unlinked change
 * exports an empty first column — which a reviewer would read as "no text
 * changed" rather than "the export could not resolve the source".
 */
function change(findingId: string, type: Change["type"] = "replaceText"): Change {
  return {
    id: uuidv4(),
    type,
    range: { start: 0, end: 5, unit: "character" },
    payload: { text: "HELLO" },
    findingId,
  } as unknown as Change;
}

// A body plus a paragraph: `buildCoverage` treats a document with no real content
// under its body as an incomplete discovery, and an incomplete report correctly
// refuses the export.
const completeCoverage = buildCoverage({
  nodes: [sampleNode("body", "one"), sampleNode("paragraph", "one")],
  text: "one",
});

function planFor(finding: Finding): ReturnType<typeof createTestPlan> {
  return createTestPlan("hash", "base", [change(finding.id)]);
}

describe("toRevisionsCsv", () => {
  it("refuses to export from an incomplete analysis", () => {
    // A change list drawn from a partial analysis is indistinguishable from a
    // complete one once it is a file on someone's disk, so the same gate Apply
    // uses gates the export.
    expect(() => toRevisionsCsv([], [], { ...completeCoverage, complete: false })).toThrow(
      /FAILED_COVERAGE/,
    );
  });

  it("emits a header-only document for an empty plan", () => {
    expect(toRevisionsCsv([], [], completeCoverage)).toBe("before,after");
  });

  it("pairs each change with its finding's before and after", () => {
    const finding = sampleFinding({ actual: "hello", expected: "HELLO" });
    const plan = planFor(finding);
    const rows = toRevisionsCsv(plan.changes, [finding], completeCoverage).split("\n");

    expect(rows[0]).toBe("before,after");
    expect(rows[1]).toBe('"hello","HELLO"');
  });

  it("escapes a quote in the text rather than corrupting the CSV", () => {
    const finding = sampleFinding({ actual: 'he said "hi"', expected: "HELLO" });
    const plan = planFor(finding);
    const csv = toRevisionsCsv(plan.changes, [finding], completeCoverage);

    expect(csv).toContain('"he said ""hi"""');
  });

  it("falls back to the change payload when the finding supplies no expected value", () => {
    const finding = sampleFinding({ actual: "hello", expected: undefined });
    const plan = planFor(finding);
    const rows = toRevisionsCsv(plan.changes, [finding], completeCoverage).split("\n");

    expect(rows[1]).toBe('"hello","HELLO"');
  });

  it("splits an over-long value rather than emitting an unusable row", () => {
    const long = "x".repeat(300);
    const finding = sampleFinding({ actual: long, expected: "short" });
    const plan = planFor(finding);
    const rows = toRevisionsCsv(plan.changes, [finding], completeCoverage).split("\n");

    expect(rows).toHaveLength(3);
    expect(rows[2]).toContain("…");
  });

  it("says nothing about a change whose finding is missing", () => {
    // The export does not invent a before/after it cannot resolve, and does not
    // fabricate a finding either: the row is emitted with an empty source.
    const plan = createTestPlan("hash", "base", [change(uuidv4())]);
    const rows = toRevisionsCsv(plan.changes, [], completeCoverage).split("\n");

    expect(rows[1]).toBe('"","HELLO"');
  });
});
