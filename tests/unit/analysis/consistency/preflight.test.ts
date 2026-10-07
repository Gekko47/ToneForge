import { describe, expect, it } from "vitest";
import { buildPreflight, redactionListFor } from "../../../../src/analysis/consistency/preflight";

describe("preflight", () => {
  describe("redactionListFor", () => {
    it("returns the opt-out line when unredacted is allowed", () => {
      const list = redactionListFor(true);
      expect(list).toHaveLength(1);
      expect(list[0]).toContain("Nothing is withheld");
    });

    it("returns the four redacted fields when unredacted is not allowed", () => {
      const list = redactionListFor(false);
      expect(list).toHaveLength(4);
      expect(list).toContain("Party names and other named entities");
      expect(list).toContain("Monetary amounts and quantities");
      expect(list).toContain("Dates and periods");
      expect(list).toContain("Quoted source text");
    });
  });

  describe("buildPreflight", () => {
    it("counts words by splitting on whitespace", () => {
      const preflight = buildPreflight({
        text: "one two  three   four",
        maxPerSubject: 5,
        maxAdjudications: 60,
        allowUnredacted: false,
      });
      expect(preflight.approximateWords).toBe(4);
    });

    it("counts statements using the same splitter as the engine", () => {
      const preflight = buildPreflight({
        text: "First sentence. Second sentence! Third one?",
        maxPerSubject: 5,
        maxAdjudications: 60,
        allowUnredacted: false,
      });
      expect(preflight.statementCount).toBe(3);
    });

    it("reports zero statements for empty text", () => {
      const preflight = buildPreflight({
        text: "",
        maxPerSubject: 5,
        maxAdjudications: 60,
        allowUnredacted: false,
      });
      expect(preflight.statementCount).toBe(0);
      expect(preflight.approximateWords).toBe(0);
    });

    it("carries the per-subject and adjudication budgets", () => {
      const preflight = buildPreflight({
        text: "text",
        maxPerSubject: 10,
        maxAdjudications: 120,
        allowUnredacted: false,
      });
      expect(preflight.maxPerSubject).toBe(10);
      expect(preflight.maxAdjudications).toBe(120);
    });

    it("reflects the allowUnredacted flag", () => {
      const preflight = buildPreflight({
        text: "text",
        maxPerSubject: 5,
        maxAdjudications: 60,
        allowUnredacted: true,
      });
      expect(preflight.allowUnredacted).toBe(true);
      expect(preflight.redactionList[0]).toContain("Nothing is withheld");
    });

    it("includes the seven-day TTL in the storage note", () => {
      const preflight = buildPreflight({
        text: "text",
        maxPerSubject: 5,
        maxAdjudications: 60,
        allowUnredacted: false,
      });
      expect(preflight.storageNote).toContain("7 days");
    });
  });
});
