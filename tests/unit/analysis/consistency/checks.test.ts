import { describe, expect, it } from "vitest";
import { CONSISTENCY_CHECKERS, checkerFor } from "../../../../src/analysis/consistency/checks";

/**
 * R0 skeleton tests: ten registered identities, stable order, loud failure
 * on an unknown id. Retrieval itself lands in R3.
 */
describe("consistency check registry", () => {
  it("registers all ten checks in id order", () => {
    expect(CONSISTENCY_CHECKERS.map((checker) => checker.id)).toEqual([
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
      "C6",
      "C7",
      "C8",
      "C9",
      "C10",
    ]);
  });

  it("returns empty candidates until R3 implements retrieval", () => {
    for (const checker of CONSISTENCY_CHECKERS) {
      expect(checker.run({ statements: [], headings: [] })).toEqual([]);
    }
  });

  it("fails loudly on an unknown id", () => {
    expect(checkerFor("C1").id).toBe("C1");
    expect(() => checkerFor("C99")).toThrow();
  });
});
