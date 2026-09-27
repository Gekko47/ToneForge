import { describe, expect, it } from "vitest";
import { findingFingerprint } from "../../../src/taskpane/findingFingerprint";
import {
  isAnyIgnored,
  isIgnoredFinding,
  withoutIgnored,
} from "../../../src/taskpane/isIgnoredFinding";
import {
  FindingSchema,
  IgnoredFindingSchema,
  type Finding,
} from "../../../src/core/domain/Finding";
import { v4 as uuidv4 } from "uuid";

/**
 * What "ignore this finding" is allowed to mean.
 *
 * It means "stop showing me this occurrence". It does NOT mean "never show me
 * this category again" — that is a different action, it needs a different name,
 * and the user has no way to undo it.
 *
 * The distinction matters because a document with a hundred em-dashes has a
 * hundred findings of the same kind. The original implementation decided
 * "ignored" by comparing `findingFingerprint`, which is the identity of a
 * *rule*, so ignoring the first em dash hid the other ninety-nine. The user saw
 * their findings disappear on one click, with no list of what had gone.
 *
 * So the fingerprint is a rule identity and must stay offset-free, and the
 * occurrence is matched separately, by position.
 */

function finding(overrides: Partial<Record<string, unknown>> = {}): Finding {
  return FindingSchema.parse({
    id: uuidv4(),
    kind: "deterministic",
    category: "typography",
    message: "Avoid an em dash.",
    severity: "warning",
    range: { start: 10, end: 20 },
    nodeIds: ["n1"],
    ruleId: "em-dash",
    actual: " — ",
    expected: ", ",
    ...overrides,
  });
}

function entryFor(target: Finding) {
  return IgnoredFindingSchema.parse({
    fingerprint: findingFingerprint(target),
    findingId: target.id,
    category: target.category,
    message: target.message,
    range: target.range,
    nodeIds: target.nodeIds,
    ignoredAt: new Date().toISOString(),
  });
}

describe("findingFingerprint", () => {
  it("is the identity of a rule, so it ignores position entirely", () => {
    // Two em-dashes in one paragraph are the same *rule* at two positions. A
    // fingerprint that separated them would stop matching after any edit above
    // them, and the ignore would silently stop working.
    const first = finding({ range: { start: 10, end: 20 } });
    const second = finding({ range: { start: 4000, end: 4010 } });
    expect(findingFingerprint(second)).toBe(findingFingerprint(first));
  });

  it("distinguishes the same text under different rules", () => {
    const spacing = finding({ ruleId: "spacing-double", actual: "a  b" });
    const emDash = finding({ ruleId: "em-dash", actual: "a  b" });

    expect(findingFingerprint(emDash)).not.toBe(findingFingerprint(spacing));
  });

  it("ignores the message, which is a label rather than an identity", () => {
    const worded = finding({ message: "An em dash was found here." });
    const reworded = finding({ message: "Em dash detected." });

    expect(findingFingerprint(reworded)).toBe(findingFingerprint(worded));
  });
});

describe("isIgnoredFinding", () => {
  it("matches the occurrence it was created for", () => {
    const target = finding();
    expect(
      isIgnoredFinding(finding({ range: target.range, nodeIds: target.nodeIds }), entryFor(target)),
    ).toBe(true);
  });

  it("does NOT hide a different occurrence of the same rule", () => {
    // The bug. Same rule, same paragraph, different position.
    const target = finding({ range: { start: 10, end: 20 } });
    const other = finding({ range: { start: 900, end: 910 } });

    expect(isIgnoredFinding(other, entryFor(target))).toBe(false);
  });

  it("does NOT hide the same rule in a different paragraph", () => {
    const target = finding({ nodeIds: ["n1"] });
    const other = finding({ nodeIds: ["n2"] });

    expect(isIgnoredFinding(other, entryFor(target))).toBe(false);
  });

  it("keeps matching after an edit shifts the finding down the document", () => {
    // The property the offset-free fingerprint cannot give on its own, and the
    // reason the matcher exists rather than a hash. A paragraph above gained a
    // few words; the occurrence is the same problem in the same place.
    const before = finding({ range: { start: 4000, end: 4010 } });
    const after = finding({ range: { start: 4137, end: 4147 } });

    expect(isIgnoredFinding(after, entryFor(before))).toBe(true);
  });

  it("does not match a different rule at the same position", () => {
    const target = finding({ ruleId: "em-dash" });
    const other = finding({ ruleId: "spacing-double", range: target.range });

    expect(isIgnoredFinding(other, entryFor(target))).toBe(false);
  });
});

describe("withoutIgnored", () => {
  it("hides one occurrence and leaves the rest of the rule visible", () => {
    // The user-visible statement of the fix: a document with three em-dashes
    // loses one finding, not three.
    const first = finding({ range: { start: 10, end: 20 } });
    const second = finding({ range: { start: 500, end: 510 } });
    const third = finding({ range: { start: 1200, end: 1210 } });

    const visible = withoutIgnored([first, second, third], [entryFor(second)]);

    expect(visible.map((item) => item.id)).toEqual([first.id, third.id]);
  });

  it("keeps every finding when nothing is ignored", () => {
    const findings = [finding(), finding(), finding()];
    expect(withoutIgnored(findings, [])).toHaveLength(3);
  });

  it("keeps findings whose position no stored entry covers", () => {
    // An entry left over from an earlier document state is not a licence to
    // hide whatever now occupies the same rule somewhere else. The user edited,
    // the problem moved, and the old position no longer describes it.
    const stale = entryFor(finding({ range: { start: 10, end: 20 } }));
    const current = [finding({ range: { start: 5000, end: 5010 } })];

    expect(withoutIgnored(current, [stale])).toHaveLength(1);
  });

  it("does not mutate the list it was given", () => {
    const findings = [finding(), finding()];
    const before = findings.map((item) => item.id);
    withoutIgnored(findings, [entryFor(findings[0] as Finding)]);
    expect(findings.map((item) => item.id)).toEqual(before);
  });
});

describe("isAnyIgnored", () => {
  it("is false for a finding no entry covers", () => {
    expect(isAnyIgnored(finding(), [entryFor(finding({ range: { start: 900, end: 910 } }))])).toBe(
      false,
    );
  });

  it("is true when any one entry covers the finding", () => {
    const target = finding({ range: { start: 10, end: 20 } });
    const entries = [entryFor(finding({ range: { start: 900, end: 910 } })), entryFor(target)];
    expect(isAnyIgnored(target, entries)).toBe(true);
  });
});
