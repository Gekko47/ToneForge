import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONSISTENCY_WINDOW_SIZE,
  comparedPairCount,
  crossWindowPairCount,
  describeCrossWindowGap,
  partitionStatementWindows,
  totalPairCount,
} from "../../../../src/analysis/consistency/batching";
import type { IndexedStatement } from "../../../../src/analysis/consistency/checks";

function statement(id: string, index: number): IndexedStatement {
  return {
    index,
    statement: { id, section: "", text: `Statement ${id}.`, start: 0, end: 10 },
  };
}

function statements(count: number): IndexedStatement[] {
  return Array.from({ length: count }, (_, index) => statement(`s${index}`, index));
}

describe("partitionStatementWindows", () => {
  it("puts a document at the bound in a single window", () => {
    const windows = partitionStatementWindows(statements(10), { windowSize: 10 });
    expect(windows).toHaveLength(1);
    expect(windows[0]?.statements).toHaveLength(10);
  });

  it("examines every statement, unlike the truncation it replaces", () => {
    // The property truncation lost. A statement past the bound used to be
    // invisible to every check, so a contradiction in it simply did not exist.
    const all = statements(25);
    const windows = partitionStatementWindows(all, { windowSize: 10 });
    const examined = windows.flatMap((window) => window.statements);
    expect(examined).toHaveLength(25);
    expect(examined.map((item) => item.statement.id)).toEqual(
      all.map((item) => item.statement.id),
    );
  });

  it("never repeats a statement across windows", () => {
    // Disjointness is what makes the pair arithmetic exact.
    const windows = partitionStatementWindows(statements(25), { windowSize: 10 });
    const ids = windows.flatMap((window) => window.statements.map((item) => item.statement.id));
    expect(new Set(ids).size).toBe(25);
  });

  it("makes the final window the remainder", () => {
    const windows = partitionStatementWindows(statements(25), { windowSize: 10 });
    expect(windows.map((window) => window.statements.length)).toEqual([10, 10, 5]);
    expect(windows.map((window) => window.firstIndex)).toEqual([0, 10, 20]);
  });

  it("returns no windows for an empty document", () => {
    expect(partitionStatementWindows([], { windowSize: 10 })).toEqual([]);
  });

  it("treats a window size below one as one rather than looping forever", () => {
    const windows = partitionStatementWindows(statements(3), { windowSize: 0 });
    expect(windows.map((window) => window.statements.length)).toEqual([1, 1, 1]);
  });

  it("numbers windows in order", () => {
    const windows = partitionStatementWindows(statements(25), { windowSize: 10 });
    expect(windows.map((window) => window.index)).toEqual([0, 1, 2]);
  });
});

describe("pair accounting", () => {
  it("reports no skipped pairs for a single window", () => {
    const windows = partitionStatementWindows(statements(10), { windowSize: 10 });
    expect(crossWindowPairCount(10, windows)).toBe(0);
    expect(comparedPairCount(windows)).toBe(totalPairCount(10));
  });

  it("counts exactly the pairs that fall between windows", () => {
    // 10 statements in windows of 10 and 10: the 100 cross pairs are the only
    // ones not compared, and the count has to be exact or "incomplete" is a
    // feeling rather than a fact.
    const windows = partitionStatementWindows(statements(20), { windowSize: 10 });
    expect(crossWindowPairCount(20, windows)).toBe(100);
    expect(comparedPairCount(windows)).toBe(90);
  });

  it("never reports a negative gap", () => {
    const windows = partitionStatementWindows(statements(10), { windowSize: 10 });
    expect(crossWindowPairCount(10, windows)).toBeGreaterThanOrEqual(0);
  });

  it("is bounded below by a single statement", () => {
    const windows = partitionStatementWindows(statements(1), { windowSize: 10 });
    expect(crossWindowPairCount(1, windows)).toBe(0);
  });
});

describe("describeCrossWindowGap", () => {
  it("names the statement count and the gap rather than implying a partial document", () => {
    const message = describeCrossWindowGap(20, 100);
    expect(message).toContain("20 statements");
    expect(message).toContain("100 pair comparisons");
    // The distinction that matters: content was read, pairs were not compared.
    expect(message).toContain("within a window were found");
  });

  it("uses singular wording for a single skipped pair", () => {
    expect(describeCrossWindowGap(4, 1)).toContain("1 pair comparison");
  });
});

describe("DEFAULT_CONSISTENCY_WINDOW_SIZE", () => {
  it("matches the documented request default", () => {
    expect(DEFAULT_CONSISTENCY_WINDOW_SIZE).toBe(400);
  });
});
