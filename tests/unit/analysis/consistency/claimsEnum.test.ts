import { describe, expect, it } from "vitest";
import {
  AdoptionStatusSchema,
  AssertionStrengthSchema,
  ClaimClassSchema,
  ClaimModalitySchema,
  ClaimScopeKindSchema,
  ExtractionPassSchema,
  ProgrammeTypeSchema,
  QuantumBasisSchema,
  ScenarioTypeSchema,
} from "../../../../src/analysis/consistency/contracts/claim";

/**
 * R1 coverage: the full claim schema is a set of enums and facets, and
 * v8 counts a Zod enum's lazy accessor as a function. Every member of
 * every enum has to be parsed for the module to reach the coverage
 * floor, so this file parses one of each. It is a schema test, not a
 * behaviour test: the behaviour is in evidenceValidator.test.ts.
 */
describe("claim schema enums", () => {
  it("parses every claim class", () => {
    const values = [
      "FACT_ASSERTION",
      "REPORTED_FACT",
      "PARTY_POSITION",
      "EXPERT_OPINION",
      "EXPERT_CONCLUSION",
      "ASSUMPTION",
      "CALCULATION",
      "FORECAST",
      "PROGRAMME_POSITION",
      "CONTRACTUAL_REQUIREMENT",
      "ENTITLEMENT_POSITION",
      "CAUSATION_POSITION",
      "RESPONSIBILITY_POSITION",
      "VALUATION_POSITION",
      "MEASUREMENT",
      "QUOTATION",
      "SCENARIO",
      "QUALIFICATION",
      "REFERENCE",
    ];
    expect(values.map((v) => ClaimClassSchema.parse(v))).toEqual(values);
    expect(() => ClaimClassSchema.parse("NOPE")).toThrow();
  });

  it("parses every adoption status", () => {
    const values = [
      "author_opinion",
      "author_conclusion",
      "author_assumption",
      "author_calculation",
      "reported_party_position",
      "quoted_source",
      "contractual_requirement",
      "contemporaneous_record",
      "hypothetical",
      "alternative_scenario",
      "unknown",
    ];
    expect(values.map((v) => AdoptionStatusSchema.parse(v))).toEqual(values);
  });

  it("parses every programme type", () => {
    const values = [
      "baseline",
      "accepted_baseline",
      "updated",
      "revised",
      "recovery",
      "as_built",
      "fragnet",
      "analysis_model",
      "unknown",
    ];
    expect(values.map((v) => ProgrammeTypeSchema.parse(v))).toEqual(values);
  });

  it("parses every quantum basis", () => {
    const values = ["nominal", "real", "unknown"];
    expect(values.map((v) => QuantumBasisSchema.parse(v))).toEqual(values);
  });

  it("parses every scope kind", () => {
    const values = ["universal", "exception", "qualified", "unknown"];
    expect(values.map((v) => ClaimScopeKindSchema.parse(v))).toEqual(values);
  });

  it("parses every modality", () => {
    const values = [
      "assertion",
      "obligation",
      "permission",
      "prohibition",
      "forecast",
      "hypothetical",
      "unknown",
    ];
    expect(values.map((v) => ClaimModalitySchema.parse(v))).toEqual(values);
  });

  it("parses every assertion strength", () => {
    const values = ["definitive", "qualified", "tentative", "unknown"];
    expect(values.map((v) => AssertionStrengthSchema.parse(v))).toEqual(values);
  });

  it("parses every scenario type", () => {
    const values = [
      "primary",
      "alternative",
      "sensitivity",
      "counterfactual",
      "party_case",
      "tribunal_assumption",
      "other",
    ];
    expect(values.map((v) => ScenarioTypeSchema.parse(v))).toEqual(values);
  });

  it("parses every extraction pass", () => {
    expect([ExtractionPassSchema.parse("local"), ExtractionPassSchema.parse("global")]).toEqual([
      "local",
      "global",
    ]);
  });
});
