import { describe, expect, it } from "vitest";
import { SystemOneResponseMapper } from "@/analysis/consistency/decision/systemOne/SystemOneResponseMapper";
import type { DecisionPlan } from "@/analysis/consistency/contracts";
import type { LlmResponse } from "@/ai/providers/LlmProvider";

describe("R5 decision: SystemOneResponseMapper", () => {
  function createPlan(): DecisionPlan {
    return {
      revision: "doc-1",
      questions: [
        {
          kind: "binary",
          id: "E-VALUE-INCOMPATIBLE",
          prompt: "Are the values incompatible after unit conversion?",
          subjectId: "cand-1",
          requestedContext: [],
        },
        {
          kind: "binary",
          id: "E-PERIOD-INCOMPATIBLE",
          prompt: "Are the periods incompatible?",
          subjectId: "cand-1",
          requestedContext: [],
        },
      ],
      projectedStates: [],
      budget: { maxQuestions: 60, maxExpansions: 20 },
      allowUnredacted: false,
      expandedContext: [],
    };
  }

  function response(text: string): LlmResponse {
    return { text, model: "mock" };
  }

  it("keeps the valid answers and drops a malformed item", () => {
    const mapper = new SystemOneResponseMapper();
    const text = JSON.stringify([
      { questionId: "E-VALUE-INCOMPATIBLE", answer: true, confidence: 0.9 },
      { questionId: "E-PERIOD-INCOMPATIBLE" },
    ]);

    const answers = mapper.map(response(text), createPlan());

    expect(mapper.parseFailed).toBe(false);
    expect(answers[0]).toMatchObject({ question: "E-VALUE-INCOMPATIBLE", answer: true });
    expect(answers[1]).toMatchObject({
      question: "E-PERIOD-INCOMPATIBLE",
      answer: "unclear",
      reasoning: "Missing from model response",
    });
  });

  it("reports a parse failure only when the response is not a JSON array", () => {
    const mapper = new SystemOneResponseMapper();
    const answers = mapper.map(response("I cannot answer that."), createPlan());

    expect(mapper.parseFailed).toBe(true);
    expect(answers.every((answer) => answer.answer === "unclear")).toBe(true);
  });
});
