import { describe, expect, it } from "vitest";
import { SystemOneCompiler } from "@/analysis/consistency/decision/systemOne/SystemOneCompiler";
import type { DecisionPlan } from "@/analysis/consistency/contracts";

describe("R5 decision: SystemOneCompiler", () => {
  const compiler = new SystemOneCompiler();

  function createPlan(overrides: Partial<DecisionPlan> = {}): DecisionPlan {
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
          kind: "choice",
          id: "E-DEFINITION-INCOMPATIBLE",
          prompt: "Are the term definitions incompatible?",
          subjectId: "cand-1",
          options: ["compatible", "incompatible", "unclear"],
          requestedContext: [],
        },
      ],
      projectedStates: [],
      budget: { maxQuestions: 60, maxExpansions: 20 },
      allowUnredacted: false,
      expandedContext: [],
      ...overrides,
    };
  }

  it("compiles a plan to a model request", () => {
    const plan = createPlan();
    const request = compiler.compile(plan);

    expect(request.systemPrompt).toBeTruthy();
    expect(request.prompt).toBeTruthy();
    expect(request.temperature).toBe(0.1);
    expect(request.maxTokens).toBe(4096);
  });

  it("includes all questions in the prompt", () => {
    const plan = createPlan();
    const request = compiler.compile(plan);

    expect(request.prompt).toContain("E-VALUE-INCOMPATIBLE");
    expect(request.prompt).toContain("E-DEFINITION-INCOMPATIBLE");
    expect(request.prompt).toContain("Are the values incompatible");
    expect(request.prompt).toContain("Are the term definitions incompatible");
  });

  it("formats choice questions with options", () => {
    const plan = createPlan();
    const request = compiler.compile(plan);

    expect(request.prompt).toContain("compatible");
    expect(request.prompt).toContain("incompatible");
    expect(request.prompt).toContain("unclear");
  });

  it("handles empty questions array", () => {
    const plan = createPlan({ questions: [] });
    const request = compiler.compile(plan);

    expect(request.prompt).toBeTruthy();
    expect(request.systemPrompt).toBeTruthy();
  });

  it("respects budget in the prompt", () => {
    const plan = createPlan({ budget: { maxQuestions: 10, maxExpansions: 5 } });
    const request = compiler.compile(plan);

    expect(request.prompt).toContain("10");
    expect(request.prompt).toContain("5");
  });

  it("includes redaction flag in the prompt", () => {
    const plan = createPlan({ allowUnredacted: true });
    const request = compiler.compile(plan);

    expect(request.prompt).toContain("unredacted");
  });

  it("includes subjectId in the prompt", () => {
    const plan = createPlan();
    const request = compiler.compile(plan);

    expect(request.prompt).toContain("cand-1");
  });

  it("includes revision in the prompt", () => {
    const plan = createPlan({ revision: "doc-42" });
    const request = compiler.compile(plan);

    expect(request.prompt).toContain("doc-42");
  });

  it("includes question kind in the prompt", () => {
    const plan = createPlan();
    const request = compiler.compile(plan);

    expect(request.prompt).toContain("binary");
    expect(request.prompt).toContain("choice");
  });

  it("redacts expanded-context content when unredacted is not allowed", () => {
    const plan = createPlan({
      allowUnredacted: false,
      expandedContext: [
        {
          candidateId: "cand-1",
          kind: "CTX-RELATED-CLAIMS",
          content: "Contact the author at author@example.com for the basis.",
        },
      ],
    });
    const request = compiler.compile(plan);

    expect(request.prompt).toContain("[REDACTED_EMAIL]");
    expect(request.prompt).not.toContain("author@example.com");
  });

  it("keeps expanded-context content exact when unredacted is allowed", () => {
    const plan = createPlan({
      allowUnredacted: true,
      expandedContext: [
        {
          candidateId: "cand-1",
          kind: "CTX-RELATED-CLAIMS",
          content: "Contact the author at author@example.com for the basis.",
        },
      ],
    });
    const request = compiler.compile(plan);

    expect(request.prompt).toContain("author@example.com");
  });
});
