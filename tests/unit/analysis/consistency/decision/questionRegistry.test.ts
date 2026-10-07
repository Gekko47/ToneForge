import { describe, expect, it } from "vitest";
import {
  QUESTION_REGISTRY,
  QUESTION_SET_VERSION,
} from "@/analysis/consistency/decision/questionRegistry";

describe("R5 decision: questionRegistry", () => {
  it("has a stable version", () => {
    expect(QUESTION_SET_VERSION).toBe("1.0");
  });

  it("contains all unique E-questions from evaluation profiles", () => {
    const allQuestions = QUESTION_REGISTRY.entries.map((e) => e.decisionQuestion);
    // There are 26 unique E-questions across all 10 C-profiles
    expect(allQuestions.length).toBe(26);
  });

  it("maps each E-question to exactly one DecisionQuestion", () => {
    const allQuestions = QUESTION_REGISTRY.entries.map((e) => e.decisionQuestion);
    const ids = new Set(allQuestions.map((q) => q.id));
    expect(ids.size).toBe(26);
  });

  it("classifies questions as binary or choice (no score questions yet)", () => {
    const allQuestions = QUESTION_REGISTRY.entries.map((e) => e.decisionQuestion);
    const types = new Set(allQuestions.map((q) => q.kind));
    expect(types).toEqual(new Set(["binary", "choice"]));
  });

  it("has 23 binary, 3 choice, 0 score questions", () => {
    const allQuestions = QUESTION_REGISTRY.entries.map((e) => e.decisionQuestion);
    const binary = allQuestions.filter((q) => q.kind === "binary").length;
    const choice = allQuestions.filter((q) => q.kind === "choice").length;
    const score = allQuestions.filter((q) => q.kind === "score").length;
    expect(binary).toBe(23);
    expect(choice).toBe(3);
    expect(score).toBe(0);
  });

  it("returns relevant questions for C1", () => {
    const questions = QUESTION_REGISTRY.getQuestionsForCheck("C1");
    expect(questions.length).toBe(5);
    const ids = questions.map((q) => q.id);
    expect(ids).toEqual([
      "E-ENTITY-SAME",
      "E-PREDICATE-COMPARABLE",
      "E-DEFINITION-INCOMPATIBLE",
      "E-EVIDENCE-SUFFICIENT",
      "E-SUBSTANTIVE-CONFLICT",
    ]);
  });

  it("returns relevant questions for C2", () => {
    const questions = QUESTION_REGISTRY.getQuestionsForCheck("C2");
    // C2 has 21 relevant E-questions (E-ATTRIBUTION-SAME is not in the profile, it's E-ATTRIBUTION-COMPATIBLE)
    expect(questions.length).toBe(21);
    const ids = questions.map((q) => q.id);
    expect(ids).toContain("E-ENTITY-SAME");
    expect(ids).toContain("E-VALUE-INCOMPATIBLE");
    expect(ids).toContain("E-SCENARIO-SAME");
    expect(ids).toContain("E-ATTRIBUTION-COMPATIBLE");
    expect(ids).toContain("E-EVIDENCE-SUFFICIENT");
    expect(ids).toContain("E-SUBSTANTIVE-CONFLICT");
  });

  it("returns relevant questions for C5 (definition)", () => {
    const questions = QUESTION_REGISTRY.getQuestionsForCheck("C5");
    expect(questions.length).toBe(5);
    const ids = questions.map((q) => q.id);
    expect(ids).toContain("E-ENTITY-SAME");
    expect(ids).toContain("E-PREDICATE-COMPARABLE");
    expect(ids).toContain("E-DEFINITION-INCOMPATIBLE");
    expect(ids).toContain("E-EVIDENCE-SUFFICIENT");
    expect(ids).toContain("E-SUBSTANTIVE-CONFLICT");
  });

  it("returns relevant questions for C8 (reference)", () => {
    const questions = QUESTION_REGISTRY.getQuestionsForCheck("C8");
    expect(questions.length).toBe(3);
    const ids = questions.map((q) => q.id);
    // Order is based on allRelevantEQuestions() iteration order
    expect(ids).toEqual([
      "E-EVIDENCE-SUFFICIENT",
      "E-SUBSTANTIVE-CONFLICT",
      "E-REFERENCE-SUPPORTS-CLAIM",
    ]);
  });

  it("returns relevant questions for C9 (section promise)", () => {
    const questions = QUESTION_REGISTRY.getQuestionsForCheck("C9");
    expect(questions.length).toBe(3);
    const ids = questions.map((q) => q.id);
    // Order is based on allRelevantEQuestions() iteration order
    expect(ids).toEqual([
      "E-EVIDENCE-SUFFICIENT",
      "E-SUBSTANTIVE-CONFLICT",
      "E-SECTION-FULFILS-PROMISE",
    ]);
  });

  it("returns empty array for unknown check", () => {
    const questions = QUESTION_REGISTRY.getQuestionsForCheck(
      "C99" as "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8" | "C9" | "C10",
    );
    expect(questions).toEqual([]);
  });

  it("each DecisionQuestion has required fields", () => {
    const allQuestions = QUESTION_REGISTRY.entries.map((e) => e.decisionQuestion);
    for (const q of allQuestions) {
      expect(q.id).toBeTruthy();
      expect(q.kind).toBeTruthy();
      expect(q.prompt).toBeTruthy();
      if (q.kind === "choice") {
        expect(q.options).toBeDefined();
        expect(q.options.length).toBeGreaterThan(1);
      }
    }
  });

  it("choice questions have proper options", () => {
    const allQuestions = QUESTION_REGISTRY.entries.map((e) => e.decisionQuestion);
    const choiceQuestions = allQuestions.filter((q) => q.kind === "choice");
    expect(choiceQuestions.length).toBe(3);
    for (const q of choiceQuestions) {
      expect(q.options).toBeDefined();
      const opts = q.options as string[];
      expect(opts.length).toBeGreaterThanOrEqual(2);
    }
  });
});
