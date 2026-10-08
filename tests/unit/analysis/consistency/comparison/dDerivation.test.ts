import { describe, it, expect } from "vitest";
import {
  deriveDOutcome,
  buildEvaluationVector,
  isConclusiveDOutcome,
  getDerivationReasonCodes,
} from "@/analysis/consistency/comparison/dDerivation";
import type { EvaluationVector } from "@/analysis/consistency/contracts";

describe("dDerivation", () => {
  describe("deriveDOutcome", () => {
    it("derives D-CONSISTENT when all facets agree", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const outcome = deriveDOutcome("C2", vector);
      expect(outcome).toBe("D-CONSISTENT");
    });

    it("derives D-NOT-COMPARABLE when subjects differ", () => {
      const vector: EvaluationVector = {
        sameSubject: false,
        samePeriod: true,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const outcome = deriveDOutcome("C2", vector);
      expect(outcome).toBe("D-NOT-COMPARABLE");
    });

    it("derives D-DIFFERENT-PERIOD when periods differ", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: false,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const outcome = deriveDOutcome("C2", vector);
      expect(outcome).toBe("D-DIFFERENT-PERIOD");
    });

    it("derives D-DIFFERENT-SCENARIO when scenarios differ", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: false,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const outcome = deriveDOutcome("C2", vector);
      expect(outcome).toBe("D-DIFFERENT-SCENARIO");
    });

    it("derives D-DIFFERENT-BASIS when bases differ", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: true,
        sameBasis: false,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const outcome = deriveDOutcome("C2", vector);
      expect(outcome).toBe("D-DIFFERENT-BASIS");
    });

    it("derives D-DIFFERENT-ATTRIBUTION when attributions differ", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: false,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const outcome = deriveDOutcome("C2", vector);
      expect(outcome).toBe("D-DIFFERENT-ATTRIBUTION");
    });

    it("derives D-DIFFERENT-SCOPE when scopes differ", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: false,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const outcome = deriveDOutcome("C10", vector);
      expect(outcome).toBe("D-DIFFERENT-SCOPE");
    });

    it("derives D-QUALIFIED-POSITION when qualifiers differ", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: false,
      };

      const outcome = deriveDOutcome("C10", vector);
      expect(outcome).toBe("D-QUALIFIED-POSITION");
    });

    it("derives D-CONFLICT when values disagree with compatible units", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: false,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const outcome = deriveDOutcome("C2", vector);
      expect(outcome).toBe("D-CONFLICT");
    });

    it("derives D-DIFFERENT-MEASUREMENT-BASIS when units are incompatible", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: false,
        qualifiersCompatible: true,
      };

      const outcome = deriveDOutcome("C2", vector);
      expect(outcome).toBe("D-DIFFERENT-MEASUREMENT-BASIS");
    });

    it("derives D-AMBIGUOUS when model answers are present but no clear outcome", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const modelAnswers = [
        {
          question: "E-DEFINITION-INCOMPATIBLE",
          holds: false,
          reason: "definitions are compatible",
        },
      ];

      const outcome = deriveDOutcome("C1", vector, modelAnswers);
      expect(outcome).toBe("D-AMBIGUOUS");
    });

    it("derives D-CONFLICT from model answers indicating substantive conflict", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const modelAnswers = [
        { question: "E-VALUE-INCOMPATIBLE", holds: true, reason: "values are incompatible" },
      ];

      const outcome = deriveDOutcome("C2", vector, modelAnswers);
      expect(outcome).toBe("D-CONFLICT");
    });

    it("derives D-DIFFERENT-PROGRAMME-BASIS from model answers", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const modelAnswers = [
        { question: "E-PROGRAMME-BASIS-SAME", holds: false, reason: "programme bases differ" },
      ];

      const outcome = deriveDOutcome("C2", vector, modelAnswers);
      expect(outcome).toBe("D-DIFFERENT-PROGRAMME-BASIS");
    });

    it("derives D-FORECAST-VS-ACTUAL from model answers", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const modelAnswers = [
        { question: "E-TEMPORAL-COMPARABLE", holds: false, reason: "temporal roles differ" },
      ];

      const outcome = deriveDOutcome("C2", vector, modelAnswers);
      expect(outcome).toBe("D-FORECAST-VS-ACTUAL");
    });

    it("derives D-DIFFERENT-VALUATION-BASIS from model answers", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const modelAnswers = [
        { question: "E-VALUATION-PERIOD-SAME", holds: false, reason: "valuation periods differ" },
      ];

      const outcome = deriveDOutcome("C2", vector, modelAnswers);
      expect(outcome).toBe("D-DIFFERENT-VALUATION-BASIS");
    });

    it("derives D-DIFFERENT-MEASUREMENT-BASIS from model answers", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const modelAnswers = [
        { question: "E-MEASUREMENT-BASIS-SAME", holds: false, reason: "measurement bases differ" },
      ];

      const outcome = deriveDOutcome("C2", vector, modelAnswers);
      expect(outcome).toBe("D-DIFFERENT-MEASUREMENT-BASIS");
    });

    it("derives D-INSUFFICIENT-EVIDENCE from model answers", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const modelAnswers = [
        { question: "E-EVIDENCE-SUFFICIENT", holds: false, reason: "evidence is insufficient" },
      ];

      const outcome = deriveDOutcome("C2", vector, modelAnswers);
      expect(outcome).toBe("D-INSUFFICIENT-EVIDENCE");
    });

    it("derives D-UPDATED-POSITION from model answers", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: true,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const modelAnswers = [
        { question: "E-UPDATE-SUPERSEDES", holds: false, reason: "update supersedes" },
      ];

      const outcome = deriveDOutcome("C2", vector, modelAnswers);
      expect(outcome).toBe("D-UPDATED-POSITION");
    });
  });

  describe("buildEvaluationVector", () => {
    it("builds a vector from deterministic and model answers", () => {
      const deterministicAnswers = [
        { question: "E-ENTITY-SAME", holds: true, reason: "shared entity IDs" },
        { question: "E-TEMPORAL-COMPARABLE", holds: true, reason: "dates are the same" },
        { question: "E-SCENARIO-SAME", holds: true, reason: "both claims in scenario actual" },
        { question: "E-BASIS-SAME", holds: true, reason: "same contractual basis" },
        { question: "E-ATTRIBUTION-COMPATIBLE", holds: true, reason: "same attribution" },
        { question: "E-SCOPE-SAME", holds: true, reason: "both claims have scope universal" },
        { question: "E-VALUE-INCOMPATIBLE", holds: false, reason: "values are equivalent" },
        { question: "E-CURRENCY-COMPATIBLE", holds: true, reason: "both claims in currency USD" },
        { question: "E-QUALIFIER-RECONCILES", holds: true, reason: "identical qualifiers" },
      ];

      const vector = buildEvaluationVector(deterministicAnswers, []);

      expect(vector.sameSubject).toBe(true);
      expect(vector.samePeriod).toBe(true);
      expect(vector.sameScenario).toBe(true);
      expect(vector.sameBasis).toBe(true);
      expect(vector.sameAttribution).toBe(true);
      expect(vector.sameScope).toBe(true);
      expect(vector.valuesAgree).toBe(true);
      expect(vector.unitsCompatible).toBe(true);
      expect(vector.qualifiersCompatible).toBe(true);
    });

    it("leaves valuesAgree undefined when the facet was never resolved", () => {
      // Regression: absence of E-VALUE-INCOMPATIBLE used to collapse to false,
      // which read as "values disagree" and fabricated a D-CONFLICT for every
      // pair the resolver could not answer.
      const deterministicAnswers = [
        { question: "E-ENTITY-SAME", holds: true, reason: "shared entity IDs" },
      ];

      const vector = buildEvaluationVector(deterministicAnswers, []);

      expect(vector.valuesAgree).toBeUndefined();
      expect(getDerivationReasonCodes("C2", vector, "D-CONSISTENT")).not.toContain(
        "values-disagree",
      );
    });

    it("builds a vector with false values when answers indicate disagreement", () => {
      const deterministicAnswers = [
        { question: "E-ENTITY-SAME", holds: false, reason: "disjoint entity IDs" },
        { question: "E-TEMPORAL-COMPARABLE", holds: false, reason: "dates conflict" },
        { question: "E-SCENARIO-SAME", holds: false, reason: "scenarios differ" },
        { question: "E-BASIS-SAME", holds: false, reason: "basis differs" },
        { question: "E-ATTRIBUTION-COMPATIBLE", holds: false, reason: "attribution differs" },
        { question: "E-SCOPE-SAME", holds: false, reason: "scope kinds differ" },
        { question: "E-VALUE-INCOMPATIBLE", holds: true, reason: "values differ" },
        { question: "E-CURRENCY-COMPATIBLE", holds: false, reason: "currencies differ" },
        { question: "E-QUALIFIER-RECONCILES", holds: false, reason: "qualifiers differ" },
      ];

      const vector = buildEvaluationVector(deterministicAnswers, []);

      expect(vector.sameSubject).toBe(false);
      expect(vector.samePeriod).toBe(false);
      expect(vector.sameScenario).toBe(false);
      expect(vector.sameBasis).toBe(false);
      expect(vector.sameAttribution).toBe(false);
      expect(vector.sameScope).toBe(false);
      expect(vector.valuesAgree).toBe(false);
      expect(vector.unitsCompatible).toBe(false);
      expect(vector.qualifiersCompatible).toBe(false);
    });
  });

  describe("isConclusiveDOutcome", () => {
    it("returns true for conclusive outcomes", () => {
      expect(isConclusiveDOutcome("D-CONSISTENT")).toBe(true);
      expect(isConclusiveDOutcome("D-CONFLICT")).toBe(true);
      expect(isConclusiveDOutcome("D-NOT-COMPARABLE")).toBe(true);
      expect(isConclusiveDOutcome("D-DIFFERENT-PERIOD")).toBe(true);
    });

    it("returns false for ambiguous outcomes", () => {
      expect(isConclusiveDOutcome("D-AMBIGUOUS")).toBe(false);
      expect(isConclusiveDOutcome("D-INSUFFICIENT-EVIDENCE")).toBe(false);
    });
  });

  describe("getDerivationReasonCodes", () => {
    it("returns reason codes for a derived outcome", () => {
      const vector: EvaluationVector = {
        sameSubject: true,
        samePeriod: false,
        sameScenario: true,
        sameBasis: true,
        sameAttribution: true,
        sameScope: true,
        valuesAgree: true,
        unitsCompatible: true,
        qualifiersCompatible: true,
      };

      const codes = getDerivationReasonCodes("C2", vector, "D-DIFFERENT-PERIOD");

      expect(codes).toContain("derived:D-DIFFERENT-PERIOD");
      expect(codes).toContain("different-period");
    });

    it("returns multiple reason codes for multiple differences", () => {
      const vector: EvaluationVector = {
        sameSubject: false,
        samePeriod: false,
        sameScenario: false,
        sameBasis: false,
        sameAttribution: false,
        sameScope: false,
        valuesAgree: false,
        unitsCompatible: false,
        qualifiersCompatible: false,
      };

      const codes = getDerivationReasonCodes("C2", vector, "D-NOT-COMPARABLE");

      expect(codes).toContain("derived:D-NOT-COMPARABLE");
      expect(codes).toContain("different-subject");
      expect(codes).toContain("different-period");
      expect(codes).toContain("different-scenario");
      expect(codes).toContain("different-basis");
      expect(codes).toContain("different-attribution");
      expect(codes).toContain("different-scope");
      expect(codes).toContain("values-disagree");
      expect(codes).toContain("units-incompatible");
    });
  });
});
