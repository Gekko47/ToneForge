/**
 * Approval semantics (spec §15, §14.7).
 *
 * The thing under test is that the three states are genuinely different
 * surfaces, and that a card can never claim two decisions at once. The old
 * single "Review" button admitted a change to Apply *and* marked the finding
 * done, and one "Reviewed" label then covered queued, declined, and
 * unapprovable alike.
 */

import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  approvalControls,
  approvedIdentities,
  decide,
  decisionCounts,
  unapprovableReason,
  undecide,
} from "../../../src/taskpane/approvalControls";
import { FindingSchema, type Finding } from "../../../src/core/domain/Finding";

function finding(overrides: Partial<Finding> = {}): Finding {
  return FindingSchema.parse({
    id: uuidv4(),
    kind: "deterministic",
    category: "formatting.bodyStyle",
    range: { start: 0, end: 1, unit: "paragraph" },
    message: "Paragraph carries Normal but the profile expects Body Text.",
    severity: "warning",
    nodeIds: [],
    source: "deterministic",
    ...overrides,
  });
}

describe("approvalControls", () => {
  it("offers Approve and Skip for an undecided finding", () => {
    const controls = approvalControls({ decision: null });
    expect(controls).toEqual({
      kind: "undecided",
      canApprove: true,
      approveReason: null,
      canSkip: true,
    });
  });

  it("withdraws Approve and Skip once approved", () => {
    const controls = approvalControls({ decision: "approved" });
    expect(controls.kind).toBe("approved");
    // `canSkip: false` rather than an absent key: the union is the declared
    // shape of each state, and a card that can still skip an approved
    // occurrence would be offering a second decision on the same span.
    expect(controls).toEqual({ kind: "approved", canSkip: false, approveReason: null });
  });

  it("keeps Approve available after a skip, because skipping is not a verdict", () => {
    // A user who skipped a group of seven by accident must be able to come back
    // and approve the one they meant. Skip is a decision about queueing, not
    // about whether the correction is right.
    expect(approvalControls({ decision: "skipped" })).toEqual({
      kind: "skipped",
      canApprove: true,
      approveReason: null,
    });
  });

  it("disables Approve with the reason when no correction exists", () => {
    const controls = approvalControls({
      decision: null,
      approveRefusal: "ToneForge cannot safely correct this property in this host.",
    });
    expect(controls.kind).toBe("undecided");
    if (controls.kind !== "undecided") return;
    expect(controls.canApprove).toBe(false);
    expect(controls.approveReason).toBe(
      "ToneForge cannot safely correct this property in this host.",
    );
  });

  it("still offers Skip when Approve is unavailable, because declining is always available", () => {
    const controls = approvalControls({ decision: null, approveRefusal: "no correction" });
    expect(controls.kind).toBe("undecided");
    if (controls.kind !== "undecided") return;
    expect(controls.canApprove).toBe(false);
    expect(controls.canSkip).toBe(true);
  });
});

describe("decide and undecide", () => {
  it("returns a new set rather than mutating the one it was given", () => {
    // A caller that mutates in place can leave the card and the projection
    // disagreeing, holding one set that only one of them updated.
    const original = new Set<string>();
    const next = decide(original, "a", "approved");
    expect(original.size).toBe(0);
    expect(next.has("a")).toBe(true);
  });

  it("keeps the newest decision for an occurrence, so the list shows one row", () => {
    const first = decide(new Set<string>(), "a", "approved");
    const second = decide(first, "a", "skipped");
    expect(second.size).toBe(1);
  });

  it("withdraws a decision so the occurrence can be decided again", () => {
    const decided = decide(new Set<string>(), "a", "approved");
    expect(undecide(decided, "a").has("a")).toBe(false);
  });

  it("leaves other occurrences alone when withdrawing one", () => {
    const decided = decide(decide(new Set<string>(), "a", "approved"), "b", "approved");
    expect(undecide(decided, "a").has("b")).toBe(true);
  });
});

describe("approvedIdentities", () => {
  it("removes a skipped occurrence from the approved set", () => {
    // The projection narrows the plan to these identities, so a skip recorded
    // in the approved set would put a change the user declined into the
    // document.
    const approved = new Set(["a", "b"]);
    const skipped = new Set(["b"]);
    expect([...approvedIdentities(approved, skipped)]).toEqual(["a"]);
  });

  it("is the same set when nothing was skipped", () => {
    const approved = new Set(["a"]);
    expect(approvedIdentities(approved, new Set()).size).toBe(1);
  });
});

describe("decisionCounts", () => {
  it("counts the overlap once, as skipped rather than approved", () => {
    // An identity in both sets is a store inconsistency rather than a decision,
    // and the safe reading is the user's later word: they declined it.
    const counts = decisionCounts({
      approved: new Set(["a", "b"]),
      skipped: new Set(["b"]),
    });
    expect(counts).toEqual({ approved: 1, skipped: 1 });
  });

  it("counts nothing when nothing was decided", () => {
    expect(decisionCounts({ approved: new Set(), skipped: new Set() })).toEqual({
      approved: 0,
      skipped: 0,
    });
  });
});

describe("unapprovableReason", () => {
  it("is null for a finding that can be corrected", () => {
    expect(unapprovableReason(finding())).toBeNull();
  });

  it("quotes the engine's own reason for an advisory finding", () => {
    // The engine's sentence is more specific than anything the UI could
    // compose, and paraphrasing it throws away the only information the user has
    // about what to do next.
    const reason = "the span could not be anchored in the document";
    expect(unapprovableReason(finding({ actionable: false, advisoryReason: reason }))).toBe(reason);
  });

  it("says there is nothing to approve when an advisory finding gives no reason", () => {
    expect(unapprovableReason(finding({ actionable: false }))).toContain("nothing to approve");
  });

  it("uses the spec's wording when a correction exists but the host cannot make it", () => {
    // Spec §14.7, quoted rather than paraphrased.
    const reason = unapprovableReason(
      finding({
        deterministic: {
          profilePath: "formatting.bodyStyle.alignment",
          correctionAvailable: false,
        },
      }),
    );
    expect(reason).toBe(
      "Detected, but ToneForge cannot safely correct this property in this Word host.",
    );
  });

  it("prefers the engine's correction reason over the generic wording", () => {
    const specific = "A property override is corrected by applying the configured Word style.";
    expect(
      unapprovableReason(
        finding({
          deterministic: {
            profilePath: "formatting.bodyStyle.alignment",
            correctionAvailable: false,
            correctionReason: specific,
          },
        }),
      ),
    ).toBe(specific);
  });
});
