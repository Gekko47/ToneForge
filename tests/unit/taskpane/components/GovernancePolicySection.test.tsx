import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  SCOPE_FLAGS,
  policyProblem,
  type PolicyDraft,
} from "../../../../src/taskpane/components/GovernancePolicySection";
import {
  ProtectionPolicySchema,
  ScopePolicySchema,
} from "../../../../src/core/domain/GovernanceProfile";
import { isProtectedNode } from "../../../../src/rules/protection";
import { updateGovernancePolicy } from "../../../../src/core/state/persistence";
import { createRecord, newProfileId } from "../../../../src/core/domain/ProfileRecord";
import { createEmptyProfile, StyleProfileSchema } from "../../../../src/core/domain/StyleProfile";
import {
  selectGovernanceHistory,
  selectGovernancePolicy,
} from "../../../../src/core/state/profileSelectors";
import { loadState, saveProfileRecord } from "../../../../src/core/state/persistence";
import { DocumentNodeSchema } from "../../../../src/core/domain/DocumentSnapshot";

/**
 * The cases that matter are the ones a user would hit by accident.
 *
 * A scope policy that excludes everything reports a clean document over a
 * document nothing looked at, and a protection override that silently did
 * nothing is the exact defect this work set out to remove. Both are asserted
 * directly rather than through the form.
 */

function draft(overrides: Partial<PolicyDraft> = {}): PolicyDraft {
  return {
    rules: [],
    preferredTerms: "",
    bannedTerms: "",
    requiredTerms: "",
    protection: ProtectionPolicySchema.parse({}),
    scope: ScopePolicySchema.parse({}),
    ...overrides,
  };
}

function scopeWith(overrides: Record<string, boolean>) {
  return ScopePolicySchema.parse(overrides);
}

describe("policyProblem", () => {
  it("accepts a default policy", () => {
    expect(policyProblem(draft())).toBeNull();
  });

  it("refuses a scope that excludes every kind of content", () => {
    // The failure this guards: every flag off means a scan reads nothing and
    // reports a clean document. The coverage gate cannot catch it, because
    // there is nothing in the report to be incomplete about.
    const everythingOff = Object.fromEntries(SCOPE_FLAGS.map((flag) => [flag.key, false]));
    const problem = policyProblem(draft({ scope: scopeWith(everythingOff) }));
    expect(problem).toContain("excludes every kind of content");
  });

  it("accepts a scope that keeps only one category", () => {
    // One category is narrow but honest: the coverage report names what was
    // skipped, so the user is told rather than misled.
    const onlyHeaders = scopeWith({ includeBody: false, includeHeadersFooters: true });
    expect(policyProblem(draft({ scope: onlyHeaders }))).toBeNull();
  });

  it("refuses body-excluded scope with nothing else to analyse", () => {
    const narrow = scopeWith({ includeBody: false, includeTables: false, includeLists: false });
    expect(policyProblem(draft({ scope: narrow }))).not.toBeNull();
  });

  it("reports a malformed preferred-term line", () => {
    expect(policyProblem(draft({ preferredTerms: "e.g." }))).toContain("term: replacement");
  });

  it("refuses a rule with no description", () => {
    // An unnamed rule cannot be cited in Pending Changes, which is the only
    // place the author would see it taking effect.
    const problem = policyProblem(
      draft({
        rules: [
          {
            id: uuidv4(),
            source: "typography",
            description: "  ",
            severity: "advisory",
            autoFix: true,
          },
        ],
      }),
    );
    expect(problem).toContain("needs a description");
  });

  it("refuses two rules bound to the same category", () => {
    // Only one rule can govern a category or the plan would have to pick
    // between them, and the loser's severity would be silently discarded.
    const problem = policyProblem(
      draft({
        rules: [
          {
            id: uuidv4(),
            source: "typography",
            description: "First",
            severity: "advisory",
            autoFix: true,
          },
          {
            id: uuidv4(),
            source: "typography",
            description: "Second",
            severity: "mandatory",
            autoFix: false,
          },
        ],
      }),
    );
    expect(problem).toContain("Only one rule governs a category");
  });
});

describe("protection overrides take effect", () => {
  const policy = {
    protection: ProtectionPolicySchema.parse({ protectCaptions: false }),
  } as unknown as Parameters<typeof isProtectedNode>[2];

  it("protects a caption under the default policy", () => {
    const node = DocumentNodeSchema.parse({
      nodeId: "n1",
      type: "caption",
      text: "Figure 1: the architecture",
      editable: true,
      includedInGovernance: true,
      sourcePath: "body",
    });
    expect(isProtectedNode(node)).toBe(true);
  });

  it("stops protecting a caption once the author turns that off", () => {
    // The defect this closes: `protectCaptions` was a schema field no code
    // path read, so turning it off changed nothing at all.
    const node = DocumentNodeSchema.parse({
      nodeId: "n1",
      type: "caption",
      text: "Figure 1: the architecture",
      editable: true,
      includedInGovernance: true,
      sourcePath: "body",
    });
    expect(isProtectedNode(node, [], policy)).toBe(false);
  });

  it("keeps protecting quoted text when only captions were unprotected", () => {
    const node = DocumentNodeSchema.parse({
      nodeId: "n2",
      type: "paragraph",
      text: 'He said "leave it alone".',
      editable: true,
      includedInGovernance: true,
      sourcePath: "body",
      protectionReason: "quoted-text",
    });
    expect(isProtectedNode(node, ["quoted-text"], policy)).toBe(true);
  });

  it("never unprotects a comment, whatever the policy says", () => {
    // A comment is addressed to a person. Unprotecting it would mean editing
    // text the author cannot see change.
    const node = DocumentNodeSchema.parse({
      nodeId: "n3",
      type: "comment",
      text: "Check this figure",
      editable: true,
      includedInGovernance: true,
      sourcePath: "comments",
    });
    const permissive = {
      protection: ProtectionPolicySchema.parse({
        protectComments: false,
        protectTextBoxes: false,
        protectShapes: false,
      }),
    } as unknown as Parameters<typeof isProtectedNode>[2];
    expect(isProtectedNode(node, [], permissive)).toBe(true);
  });

  it("honours a user-locked range", () => {
    const node = DocumentNodeSchema.parse({
      nodeId: "locked-1",
      type: "paragraph",
      text: "Do not touch",
      editable: true,
      includedInGovernance: true,
      sourcePath: "body",
    });
    const locking = {
      protection: ProtectionPolicySchema.parse({ userLockedRanges: ["locked-1"] }),
    } as unknown as Parameters<typeof isProtectedNode>[2];
    expect(isProtectedNode(node, [], locking)).toBe(true);
  });
});

describe("updateGovernancePolicy", () => {
  function seed(): string {
    window.localStorage.clear();
    const profile = StyleProfileSchema.parse(createEmptyProfile("Policy host", 1));
    const record = createRecord(newProfileId(), profile.name, new Date().toISOString(), profile);
    saveProfileRecord(record);
    return record.id;
  }

  it("versions the policy and records it in history", () => {
    const id = seed();
    const before = selectGovernancePolicy(loadState(), id);
    expect(before?.version).toBe(1);

    const next = updateGovernancePolicy(id, {
      ...(before as NonNullable<typeof before>),
      rules: [
        {
          id: uuidv4(),
          description: "Terminology is mandatory",
          scope: "houseStyle",
          source: "houseStyle.terminology",
          severity: "mandatory",
          autoFix: true,
          protectedBehavior: "flag",
          remediation: "",
        },
      ],
    });

    expect(next.version).toBe(2);
    // Reloaded, not read back from the return value: the round trip through
    // storage is the thing that has to work.
    const stored = selectGovernancePolicy(loadState(), id);
    expect(stored?.rules).toHaveLength(1);
    expect(stored?.rules[0]?.severity).toBe("mandatory");
    const history = selectGovernanceHistory(loadState(), id);
    expect(history).toHaveLength(2);
    expect(history[0]?.version).toBe(1);
  });

  it("refuses a policy that would govern a different style profile", () => {
    const id = seed();
    const current = selectGovernancePolicy(loadState(), id);
    const other = StyleProfileSchema.parse(createEmptyProfile("Different", 1));
    expect(() =>
      updateGovernancePolicy(id, { ...(current as NonNullable<typeof current>), style: other }),
    ).toThrow(/cannot change the style profile/);
  });

  it("refuses to write a policy for a profile that has none", () => {
    window.localStorage.clear();
    expect(() => updateGovernancePolicy(uuidv4(), {} as never)).toThrow(/no governance profile/);
  });
});
