import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHostMatrixDashboard,
  EVIDENCE_STALENESS_DAYS,
  extractEvidenceDate,
  extractHostMatrix,
  hasObservation,
  HOST_MATRIX_CHECKS,
  renderHostMatrixDashboard,
} from "../../../scripts/host-matrix.mjs";

/**
 * The dashboard reads a document people forget to update, so the tests are
 * mostly about what it refuses to claim:
 *
 * - an unrecorded cell is `unknown`, never a pass;
 * - two passes and one silence is `partial`, not `pass`;
 * - stale evidence is flagged rather than quietly presented as current;
 * - the output can never assert release readiness on its own.
 */

const TODAY = new Date("2026-06-01T00:00:00.000Z");

function doc(rows: string[], evidenceDate: string | null = "2026-05-01"): string {
  return [
    "# ToneForge — Manual Word Verification",
    "",
    "## Host matrix",
    "",
    "| Host | Version | Browser/engine | Sideload | Task pane | Probe | Current evidence |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    ...(evidenceDate === null ? [] : [`## Local debugging evidence — ${evidenceDate}`, ""]),
  ].join("\n");
}

const ALL_PASS = "| Word on Windows | 16 | Edge | PASS | PASS | PASS | Done. |";

describe("hasObservation", () => {
  it("treats a recorded value as an observation", () => {
    expect(hasObservation("PASS")).toBe(true);
    expect(hasObservation("PARTIAL")).toBe(true);
  });

  it("treats an empty cell as no observation", () => {
    expect(hasObservation("")).toBe(false);
    expect(hasObservation("   ")).toBe(false);
    expect(hasObservation(undefined)).toBe(false);
  });

  it("treats every placeholder for 'nobody looked' as no observation", () => {
    ["-", "--", "—", "–", "N/A", "n/a", "TBD", "?", "unknown"].forEach((value) => {
      expect(hasObservation(value)).toBe(false);
    });
  });
});

describe("extractHostMatrix", () => {
  it("reads the header and every data row", () => {
    const { header, dataRows } = extractHostMatrix(
      doc([ALL_PASS, "| Word on Mac | — | Safari | — | — | — | No. |"]),
    );
    expect(header[0]).toBe("Host");
    expect(dataRows).toHaveLength(2);
  });

  it("fails loudly when the section is missing", () => {
    // A silently empty dashboard would read as "no hosts, nothing to worry
    // about", which is the opposite of what a missing section means.
    expect(() => extractHostMatrix("# Some other document")).toThrow(/Host matrix/);
  });

  it("fails loudly when the section has no rows", () => {
    expect(() => extractHostMatrix("## Host matrix\n\nNothing here.\n")).toThrow(/no data rows/);
  });

  it("ignores a table outside the host-matrix section", () => {
    const markdown = `${doc([ALL_PASS])}\n## Other table\n\n| Host | Version |\n| --- | --- |\n| Wrong | Wrong |\n`;
    const { dataRows } = extractHostMatrix(markdown);
    expect(dataRows).toHaveLength(1);
    expect(dataRows[0]?.[0]).toBe("Word on Windows");
  });
});

describe("extractEvidenceDate", () => {
  it("finds the latest dated evidence section", () => {
    const markdown = "## A evidence — 2026-01-01\n\n## B evidence — 2026-05-20\n";
    expect(extractEvidenceDate(markdown)).toBe("2026-05-20");
  });

  it("handles an em dash as well as a hyphen", () => {
    expect(extractEvidenceDate("## Desktop evidence — 2026-03-04\n")).toBe("2026-03-04");
    expect(extractEvidenceDate("## Desktop evidence - 2026-03-04\n")).toBe("2026-03-04");
  });

  it("returns null when nothing is dated", () => {
    expect(extractEvidenceDate("# No dates here")).toBeNull();
  });
});

describe("buildHostMatrixDashboard", () => {
  it("marks a fully passing host as passing", () => {
    const dashboard = buildHostMatrixDashboard(doc([ALL_PASS]), { now: TODAY });
    expect(dashboard.rows[0]?.overall).toBe("pass");
    expect(dashboard.totals.passing).toBe(1);
  });

  it("never calls a silent cell a pass", () => {
    const dashboard = buildHostMatrixDashboard(
      doc(["| Word on Windows | 16 | Edge | PASS | PASS | — | Partly done. |"]),
      { now: TODAY },
    );
    expect(dashboard.rows[0]?.overall).not.toBe("pass");
    expect(dashboard.rows[0]?.statuses).toContain("unknown");
  });

  it("calls two passes and one silence partial, not pass", () => {
    const dashboard = buildHostMatrixDashboard(
      doc(["| Word on Windows | 16 | Edge | PASS | PASS | PENDING | Partly done. |"]),
      { now: TODAY },
    );
    expect(dashboard.rows[0]?.overall).toBe("partial");
  });

  it("calls a row with an explicit failure a failure", () => {
    const dashboard = buildHostMatrixDashboard(
      doc(["| Word on Windows | 16 | Edge | FAIL | PASS | PASS | Broke. |"]),
      { now: TODAY },
    );
    expect(dashboard.rows[0]?.overall).toBe("fail");
  });

  it("calls a wholly unobserved row unknown", () => {
    const dashboard = buildHostMatrixDashboard(
      doc(["| Word on Mac | — | Safari | — | — | — | Not recorded. |"]),
      { now: TODAY },
    );
    expect(dashboard.rows[0]?.overall).toBe("unknown");
  });

  it("calls a wholly pending row pending", () => {
    const dashboard = buildHostMatrixDashboard(
      doc(["| Word on the web | — | Chrome | PENDING | PENDING | PENDING | Not started. |"]),
      { now: TODAY },
    );
    expect(dashboard.rows[0]?.overall).toBe("pending");
  });

  it("accepts the case-insensitive spellings the document actually uses", () => {
    const dashboard = buildHostMatrixDashboard(
      doc(["| Word on Windows | 16 | Edge | PASS | PASS | PARTIAL | Some. |"]),
      { now: TODAY },
    );
    expect(dashboard.rows[0]?.statuses).toEqual(["pass", "pass", "partial"]);
  });

  it("does not treat a build number as a verdict", () => {
    // "Edge WebView2 153" is a descriptor. Reading it as a status would both
    // lose the value and imply it had been assessed.
    const dashboard = buildHostMatrixDashboard(
      doc(["| Word on Windows | unknown | Edge WebView2 153 | PASS | PASS | PASS | Done. |"]),
      { now: TODAY },
    );
    expect(dashboard.rows[0]?.engine).toBe("Edge WebView2 153");
    expect(dashboard.rows[0]?.checks).toHaveLength(HOST_MATRIX_CHECKS.length);
    expect(dashboard.checks).toEqual(["Sideload", "Task pane", "Probe"]);
  });

  it("flags evidence older than the staleness window", () => {
    const old = buildHostMatrixDashboard(doc([ALL_PASS], "2025-01-01"), { now: TODAY });
    expect(old.staleEvidence).toBe(true);
    expect(old.evidenceAgeDays).toBeGreaterThan(EVIDENCE_STALENESS_DAYS);
  });

  it("does not flag fresh evidence as stale", () => {
    const fresh = buildHostMatrixDashboard(doc([ALL_PASS], "2026-05-25"), { now: TODAY });
    expect(fresh.staleEvidence).toBe(false);
    expect(fresh.evidenceAgeDays).toBeLessThan(EVIDENCE_STALENESS_DAYS);
  });

  it("reports a missing evidence date rather than assuming freshness", () => {
    const undated = buildHostMatrixDashboard(doc([ALL_PASS], null), { now: TODAY });
    expect(undated.evidenceDate).toBeNull();
    expect(undated.evidenceAgeDays).toBeNull();
    // With no date the staleness flag must not read "current".
    expect(undated.staleEvidence).toBe(false);
    expect(renderHostMatrixDashboard(undated)).toMatch(/No evidence date found/);
  });

  it("still reports stale when the underlying statuses are all passes", () => {
    // A stale all-green row is the most dangerous shape, so it gets its own test.
    const stale = buildHostMatrixDashboard(doc([ALL_PASS], "2024-01-01"), { now: TODAY });
    expect(stale.rows[0]?.overall).toBe("pass");
    expect(stale.staleEvidence).toBe(true);
  });

  it("never reports release readiness on its own", () => {
    const dashboard = buildHostMatrixDashboard(doc([ALL_PASS], "2026-05-25"), { now: TODAY });
    expect(dashboard.releaseReady).toBe(false);
  });

  it("counts every host even when nothing was observed", () => {
    const dashboard = buildHostMatrixDashboard(
      doc([
        "| A | — | — | — | — | — | No. |",
        "| B | — | — | — | — | — | No. |",
        "| C | — | — | — | — | — | No. |",
      ]),
      { now: TODAY },
    );
    expect(dashboard.totals.hosts).toBe(3);
    expect(dashboard.totals.passing).toBe(0);
  });

  it("sums rows by overall status", () => {
    const dashboard = buildHostMatrixDashboard(
      doc([
        "| A | 16 | Edge | PASS | PASS | PASS | Done. |",
        "| B | 16 | Edge | FAIL | PASS | PASS | Broke. |",
        "| C | — | Safari | — | — | — | No. |",
      ]),
      { now: TODAY },
    );
    expect(dashboard.totals.byOverall).toMatchObject({ pass: 1, fail: 1, unknown: 1 });
  });

  it("keeps the evidence prose attached to its row", () => {
    const dashboard = buildHostMatrixDashboard(
      doc(["| Word on Windows | 16 | Edge | PASS | PASS | PARTIAL | Breaks remain false. |"]),
      { now: TODAY },
    );
    expect(dashboard.rows[0]?.evidence).toBe("Breaks remain false.");
  });
});

describe("renderHostMatrixDashboard", () => {
  it("states that the output is generated", () => {
    const markdown = renderHostMatrixDashboard(
      buildHostMatrixDashboard(doc([ALL_PASS], "2026-05-25"), { now: TODAY }),
    );
    expect(markdown).toMatch(/Generated from/);
    expect(markdown).toMatch(/Do not edit by hand/);
  });

  it("shows the engine and version verbatim", () => {
    const markdown = renderHostMatrixDashboard(
      buildHostMatrixDashboard(
        doc(
          ["| Word on Windows | 16.0 | Edge WebView2 153 | PASS | PASS | PASS | Done. |"],
          "2026-05-25",
        ),
        { now: TODAY },
      ),
    );
    expect(markdown).toContain("Edge WebView2 153");
    expect(markdown).toContain("16.0");
  });

  it("warns loudly when evidence is stale", () => {
    const markdown = renderHostMatrixDashboard(
      buildHostMatrixDashboard(doc([ALL_PASS], "2024-01-01"), { now: TODAY }),
    );
    expect(markdown).toMatch(/Evidence is stale/);
  });

  it("repeats that the human host gate is separate", () => {
    const markdown = renderHostMatrixDashboard(
      buildHostMatrixDashboard(doc([ALL_PASS], "2026-05-25"), { now: TODAY }),
    );
    expect(markdown).toMatch(/separate/i);
  });

  it("lists a row per host", () => {
    const markdown = renderHostMatrixDashboard(
      buildHostMatrixDashboard(
        doc([ALL_PASS, "| Word on Mac | — | Safari | — | — | — | No. |"], "2026-05-25"),
        {
          now: TODAY,
        },
      ),
    );
    expect(markdown).toContain("Word on Windows");
    expect(markdown).toContain("Word on Mac");
  });
});

describe("the real docs/manual-verification.md", () => {
  const markdown = readFileSync(join("docs", "manual-verification.md"), "utf8");
  const dashboard = buildHostMatrixDashboard(markdown);

  it("parses without throwing", () => {
    expect(dashboard.rows.length).toBeGreaterThan(0);
  });

  it("reports no host as fully passing", () => {
    // The documented position: desktop text paths were exercised, but breaks
    // and styles are still false and three hosts were never recorded. A
    // dashboard that said otherwise would be lying about the release gate.
    expect(dashboard.totals.passing).toBe(0);
  });

  it("keeps the human host gate open", () => {
    expect(dashboard.releaseReady).toBe(false);
  });
});
