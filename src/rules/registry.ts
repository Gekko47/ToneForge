/**
 * Rule registry v1 — stable IDs and severity mapping.
 *
 * Registers existing typography plus house-style rule IDs.
 * Maps mandatory→error, advisory→warning, informational→info.
 *
 * Boundary rule: rules/ must stay deterministic — no Office, AI, or UI imports.
 */

import type { Severity } from "../core/domain/Finding";

export interface RuleDescriptor {
  id: string;
  description: string;
  scope: string;
  severity: "mandatory" | "advisory" | "informational";
  autoFix: boolean;
  protectedBehavior: "skip" | "flag" | "block";
  remediation: string;
}

/** Map severity to engine severity level. */
export function mapSeverity(severity: RuleDescriptor["severity"]): Severity {
  switch (severity) {
    case "mandatory":
      return "error";
    case "advisory":
      return "warning";
    case "informational":
      return "info";
  }
}

/** Existing typography rule IDs. */
export const TYPOGRAPHY_RULE_IDS: RuleDescriptor[] = [
  {
    id: "typography/em-dash",
    description: "Em dash representation",
    scope: "typography",
    severity: "mandatory",
    autoFix: true,
    protectedBehavior: "flag",
    remediation: "Replace with Unicode em dash character",
  },
  {
    id: "typography/en-dash-spacing",
    description: "En dash spacing",
    scope: "typography",
    severity: "advisory",
    autoFix: false,
    protectedBehavior: "flag",
    remediation: "Add or remove space around en dash",
  },
  {
    id: "typography/double-quotes",
    description: "Double quote style",
    scope: "typography",
    severity: "mandatory",
    autoFix: true,
    protectedBehavior: "flag",
    remediation: "Replace straight quotes with curly quotes",
  },
  {
    id: "typography/ellipsis",
    description: "Ellipsis representation",
    scope: "typography",
    severity: "mandatory",
    autoFix: true,
    protectedBehavior: "flag",
    remediation: "Replace three dots with ellipsis character",
  },
  {
    id: "typography/decimal-separator",
    description: "Decimal separator",
    scope: "typography",
    severity: "advisory",
    autoFix: false,
    protectedBehavior: "flag",
    remediation: "Use configured decimal separator",
  },
];

/** Existing house-style rule IDs. */
export const HOUSE_STYLE_RULE_IDS: RuleDescriptor[] = [
  {
    id: "houseStyle/banned-terms",
    description: "Banned terminology",
    scope: "houseStyle",
    severity: "mandatory",
    autoFix: false,
    protectedBehavior: "flag",
    remediation: "Replace banned term with preferred terminology",
  },
  {
    id: "houseStyle/preferred-terms",
    description: "Preferred terminology",
    scope: "houseStyle",
    severity: "advisory",
    autoFix: false,
    protectedBehavior: "flag",
    remediation: "Use preferred term from house style",
  },
  {
    id: "houseStyle/capitalization",
    description: "Capitalization consistency",
    scope: "houseStyle",
    severity: "advisory",
    autoFix: false,
    protectedBehavior: "flag",
    remediation: "Apply configured capitalization rules",
  },
];

/** All registered rules. */
export const ALL_RULES: RuleDescriptor[] = [...TYPOGRAPHY_RULE_IDS, ...HOUSE_STYLE_RULE_IDS];

/** Look up a rule by ID. */
export function getRule(id: string): RuleDescriptor | undefined {
  return ALL_RULES.find((rule) => rule.id === id);
}
