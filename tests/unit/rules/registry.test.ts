import { describe, expect, it } from "vitest";
import {
  mapSeverity,
  TYPOGRAPHY_RULE_IDS,
  HOUSE_STYLE_RULE_IDS,
  ALL_RULES,
  getRule,
} from "../../../src/rules/registry";
import type { RuleDescriptor } from "../../../src/rules/registry";

describe("mapSeverity", () => {
  it("maps mandatory to error", () => {
    expect(mapSeverity("mandatory")).toBe("error");
  });

  it("maps advisory to warning", () => {
    expect(mapSeverity("advisory")).toBe("warning");
  });

  it("maps informational to info", () => {
    expect(mapSeverity("informational")).toBe("info");
  });
});

describe("TYPOGRAPHY_RULE_IDS", () => {
  it("has at least one rule", () => {
    expect(TYPOGRAPHY_RULE_IDS.length).toBeGreaterThan(0);
  });

  it("all rules have valid severity", () => {
    TYPOGRAPHY_RULE_IDS.forEach((rule) => {
      expect(["mandatory", "advisory", "informational"]).toContain(rule.severity);
    });
  });

  it("all rules have valid autoFix boolean", () => {
    TYPOGRAPHY_RULE_IDS.forEach((rule) => {
      expect(typeof rule.autoFix).toBe("boolean");
    });
  });
});

describe("HOUSE_STYLE_RULE_IDS", () => {
  it("has at least one rule", () => {
    expect(HOUSE_STYLE_RULE_IDS.length).toBeGreaterThan(0);
  });

  it("all rules have valid scope", () => {
    HOUSE_STYLE_RULE_IDS.forEach((rule) => {
      expect(rule.scope).toBe("houseStyle");
    });
  });
});

describe("ALL_RULES", () => {
  it("combines typography and house-style rules", () => {
    expect(ALL_RULES.length).toBe(TYPOGRAPHY_RULE_IDS.length + HOUSE_STYLE_RULE_IDS.length);
  });
});

describe("getRule", () => {
  it("finds a rule by ID", () => {
    const rule = getRule("typography/em-dash");
    expect(rule).toBeDefined();
    expect(rule?.id).toBe("typography/em-dash");
  });

  it("returns undefined for unknown ID", () => {
    expect(getRule("nonexistent/rule")).toBeUndefined();
  });
});

describe("RuleDescriptor type", () => {
  it("has all required fields", () => {
    const rule: RuleDescriptor = {
      id: "test/rule",
      description: "Test",
      scope: "typography",
      severity: "mandatory",
      autoFix: true,
      protectedBehavior: "flag",
      remediation: "Fix it",
    };
    expect(rule.id).toBe("test/rule");
    expect(rule.scope).toBe("typography");
  });
});
