import { describe, it, expect } from "vitest";
import {
  computeConfidence,
  meetsReviewThreshold,
  meetsPresentationThreshold,
  getConfidenceBand,
  formatConfidence,
} from "@/analysis/consistency/comparison/confidenceEngine";
import type { EvaluationVector } from "@/analysis/consistency/contracts";

describe("confidenceEngine", () => {
  describe("computeConfidence", () => {
    it("computes high confidence for fully resolved vector", () => {
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

      const confidence = computeConfidence("C2", vector, [], deterministicAnswers, "D-CONSISTENT");

      expect(confidence.point).toBeGreaterThan(0.5);
      expect(confidence.lower).toBeLessThanOrEqual(confidence.point);
      expect(confidence.upper).toBeGreaterThanOrEqual(confidence.point);
      expect(confidence.calibrationVersion).toBe("consistency_decision-v1");
      expect(confidence.reviewThreshold).toBe(0.6);
      expect(confidence.presentationThreshold).toBe(0.75);
    });

    it("computes lower confidence for unresolved facets", () => {
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

      const deterministicAnswers = [
        { question: "E-ENTITY-SAME", holds: true, reason: "shared entity IDs" },
      ];

      const confidence = computeConfidence("C2", vector, [], deterministicAnswers, "D-AMBIGUOUS");

      expect(confidence.point).toBeLessThan(0.5);
      expect(confidence.lower).toBeLessThanOrEqual(confidence.point);
      expect(confidence.upper).toBeGreaterThanOrEqual(confidence.point);
    });

    it("computes confidence with model answers", () => {
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

      const deterministicAnswers = [
        { question: "E-ENTITY-SAME", holds: true, reason: "shared entity IDs" },
      ];

      const modelAnswers = [
        {
          question: "E-DEFINITION-INCOMPATIBLE",
          holds: false,
          confidence: 0.8,
          reason: "definitions are compatible",
        },
      ];

      const confidence = computeConfidence(
        "C1",
        vector,
        modelAnswers,
        deterministicAnswers,
        "D-CONSISTENT",
      );

      expect(confidence.point).toBeGreaterThan(0.5);
      expect(confidence.lower).toBeLessThanOrEqual(confidence.point);
      expect(confidence.upper).toBeGreaterThanOrEqual(confidence.point);
    });

    it("computes wider interval for low model confidence", () => {
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

      const deterministicAnswers = [
        { question: "E-ENTITY-SAME", holds: true, reason: "shared entity IDs" },
      ];

      const modelAnswersLow = [
        {
          question: "E-DEFINITION-INCOMPATIBLE",
          holds: false,
          confidence: 0.2,
          reason: "uncertain",
        },
      ];

      const modelAnswersHigh = [
        { question: "E-DEFINITION-INCOMPATIBLE", holds: false, confidence: 0.9, reason: "certain" },
      ];

      const confidenceLow = computeConfidence(
        "C1",
        vector,
        modelAnswersLow,
        deterministicAnswers,
        "D-CONSISTENT",
      );

      const confidenceHigh = computeConfidence(
        "C1",
        vector,
        modelAnswersHigh,
        deterministicAnswers,
        "D-CONSISTENT",
      );

      const widthLow = confidenceLow.upper - confidenceLow.lower;
      const widthHigh = confidenceHigh.upper - confidenceHigh.lower;

      expect(widthLow).toBeGreaterThan(widthHigh);
    });
  });

  describe("meetsReviewThreshold", () => {
    it("returns true when point meets review threshold", () => {
      const confidence = {
        point: 0.7,
        lower: 0.6,
        upper: 0.8,
        calibrationVersion: "consistency_decision-v1",
        reviewThreshold: 0.6,
        presentationThreshold: 0.75,
      };

      expect(meetsReviewThreshold(confidence)).toBe(true);
    });

    it("returns false when point is below review threshold", () => {
      const confidence = {
        point: 0.5,
        lower: 0.4,
        upper: 0.6,
        calibrationVersion: "consistency_decision-v1",
        reviewThreshold: 0.6,
        presentationThreshold: 0.75,
      };

      expect(meetsReviewThreshold(confidence)).toBe(false);
    });
  });

  describe("meetsPresentationThreshold", () => {
    it("returns true when point meets presentation threshold", () => {
      const confidence = {
        point: 0.8,
        lower: 0.7,
        upper: 0.9,
        calibrationVersion: "consistency_decision-v1",
        reviewThreshold: 0.6,
        presentationThreshold: 0.75,
      };

      expect(meetsPresentationThreshold(confidence)).toBe(true);
    });

    it("returns false when point is below presentation threshold", () => {
      const confidence = {
        point: 0.7,
        lower: 0.6,
        upper: 0.8,
        calibrationVersion: "consistency_decision-v1",
        reviewThreshold: 0.6,
        presentationThreshold: 0.75,
      };

      expect(meetsPresentationThreshold(confidence)).toBe(false);
    });
  });

  describe("getConfidenceBand", () => {
    it("returns high for narrow interval and high point", () => {
      const confidence = {
        point: 0.8,
        lower: 0.75,
        upper: 0.85,
        calibrationVersion: "consistency_decision-v1",
        reviewThreshold: 0.6,
        presentationThreshold: 0.75,
      };

      expect(getConfidenceBand(confidence)).toBe("high");
    });

    it("returns medium for moderate interval and point", () => {
      const confidence = {
        point: 0.6,
        lower: 0.4,
        upper: 0.8,
        calibrationVersion: "consistency_decision-v1",
        reviewThreshold: 0.6,
        presentationThreshold: 0.75,
      };

      expect(getConfidenceBand(confidence)).toBe("medium");
    });

    it("returns low for wide interval or low point", () => {
      const confidence = {
        point: 0.4,
        lower: 0.1,
        upper: 0.7,
        calibrationVersion: "consistency_decision-v1",
        reviewThreshold: 0.6,
        presentationThreshold: 0.75,
      };

      expect(getConfidenceBand(confidence)).toBe("low");
    });
  });

  describe("formatConfidence", () => {
    it("formats confidence as percentage with interval", () => {
      const confidence = {
        point: 0.72,
        lower: 0.65,
        upper: 0.79,
        calibrationVersion: "consistency_decision-v1",
        reviewThreshold: 0.6,
        presentationThreshold: 0.75,
      };

      expect(formatConfidence(confidence)).toBe("72% [65%–79%]");
    });

    it("rounds percentages correctly", () => {
      const confidence = {
        point: 0.725,
        lower: 0.654,
        upper: 0.796,
        calibrationVersion: "consistency_decision-v1",
        reviewThreshold: 0.6,
        presentationThreshold: 0.75,
      };

      expect(formatConfidence(confidence)).toBe("73% [65%–80%]");
    });
  });
});
