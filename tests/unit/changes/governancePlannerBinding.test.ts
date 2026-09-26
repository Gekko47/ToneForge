import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { planChanges } from "../../../src/changes/planner";
import { GovernanceRuleSchema, type GovernanceRule } from "../../../src/core/domain/GovernanceProfile";
import { FindingSchema, type Finding } from "../../../src/core/domain/Finding";

/**
 * A governance rule has to change what the planner does, or it is a field the
 * plan cites a revision for and never reads.
 *
 * The four effects worth pinning are the ones a user can observe: a category
 * stops producing changes, a change starts requiring approval, the change
 * explains which policy produced it, and an ungoverned category is untouched.
 */

function rule(overrides: Partial<GovernanceRule> = {}): GovernanceRule {
  return GovernanceRuleSchema.parse({
    id: uuidv4(),
    description: "House terminology is mandatory",
    scope: "houseStyle",
    source: "houseStyle.terminology",
    severity: "mandatory",
    autoFix: true,
    protectedBehavior: "flag",
    remediation: "Use the preferred term",
    ...overrides,
  });
}

/** A low-risk, reversible, deterministic finding — the baseline that needs no approval. */
function finding(overrides: Partial<Finding> = {}): Finding {
  return FindingSchema.parse({
    id: uuidv4(),
    kind: "deterministic",
    category: "houseStyle.terminology",
    // The message shape the planner parses for a quoted replacement. A finding
    // whose message names no replacement produces no change, which would make
    // every rule assertion below pass for the wrong reason.
    message: 'Use "for example" instead of "e.g."',
    evidence: "This e.g. is informal.",
    actual: "e.g.",
    expected: "for example",
    range: { start: 4, end: 8, unit: "character" },
    severity: "warning",
    risk: "low",
    source: "deterministic",
    status: "new",
    reversible: true,
    ...overrides,
  });
}

function plan(f: Finding, rules?: GovernanceRule[]) {
  return planChanges({
    findings: [f],
    docHash: "hash-1",
    baseDocId: "doc-1",
    ...(rules === undefined ? {} : { governanceRules: rules }),
  });
}

describe("governance rules in the planner", () => {
  it("plans a change when no rule governs the category", () => {
    expect(plan(finding()).changes).toHaveLength(1);
  });

  it("produces no change when the rule withholds auto-fix", () => {
    // The finding still appears in the report — the author's choice is "report
    // it, do not change it", not "do not report it".
    const result = plan(finding(), [rule({ autoFix: false })]);
    expect(result.changes).toHaveLength(0);
    expect(result.findings).toHaveLength(1);
  });

  it("produces a change when the rule opts the category into auto-fix", () => {
    expect(plan(finding(), [rule({ autoFix: true })]).changes).toHaveLength(1);
  });

  it("does not apply a rule to a category it does not govern", () => {
    // A typography rule must not silence terminology findings.
    const result = plan(finding(), [rule({ source: "typography", autoFix: false })]);
    expect(result.changes).toHaveLength(1);
  });

  it("requires approval for a mandatory rule on a finding that would otherwise need none", () => {
    const withoutRule = plan(finding()).changes[0];
    expect(withoutRule?.approvalRequired).toBe(false);

    const change = plan(finding(), [rule({ severity: "mandatory" })]).changes[0];
    expect(change?.approvalRequired).toBe(true);
    expect(change?.approvalState).toBe("pending");
  });

  it("leaves an advisory rule's approval requirement alone", () => {
    const change = plan(finding(), [rule({ severity: "advisory" })]).changes[0];
    expect(change?.approvalRequired).toBe(false);
  });

  it("cannot lower an approval requirement the finding already needed", () => {
    // Policy may add caution. A rule the author can use to remove a safeguard
    // is not a safeguard.
    const risky = finding({ risk: "high" });
    const change = plan(risky, [rule({ severity: "advisory" })]).changes[0];
    expect(change?.approvalRequired).toBe(true);
  });

  it("cites the policy in the change rationale", () => {
    const change = plan(finding(), [rule()]).changes[0];
    expect(change?.rationale).toContain("House terminology is mandatory");
  });

  it("leaves the rationale untouched when no rule governs the change", () => {
    expect(plan(finding()).changes[0]?.rationale).not.toContain("policy:");
  });
});
