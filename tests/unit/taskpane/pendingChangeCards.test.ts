/**
 * The Pending Changes card model.
 *
 * The judgement under test is what a card is allowed to claim. A five-column
 * table in a 320px pane put seven fields side by side and every cell was one
 * word wide; the cards give one change the full width, which means each field
 * has to earn its place. The two that can lie are the location label and the
 * before/after text, so those are what these tests pin.
 */

import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  buildPendingChangeCards,
  pendingChangeTotals,
} from "../../../src/taskpane/pendingChangeCards";
import { createChangePlan } from "../../../src/core/domain/ChangePlan";
import { FindingSchema, type Finding } from "../../../src/core/domain/Finding";
import type { Change, ChangePlan } from "../../../src/core/domain";

function finding(overrides: Partial<Finding> = {}): Finding {
  return FindingSchema.parse({
    id: uuidv4(),
    kind: "deterministic",
    category: "language.terminology.preferred",
    range: { start: 4, end: 10, unit: "character" },
    message: "Use programme instead of program",
    severity: "warning",
    actual: "program",
    expected: "programme",
    nodeIds: [],
    source: "deterministic",
    ...overrides,
  });
}

function change(overrides: Partial<Change> = {}): Change {
  return {
    id: uuidv4(),
    type: "replaceText",
    range: { start: 4, end: 10 },
    payload: { text: "programme" },
    source: "deterministic",
    risk: "none",
    approvalRequired: false,
    approvalState: "notRequired",
    precondition: { kind: "text", expectedText: "program" },
    ...overrides,
  } as Change;
}

function planWith(changes: Change[], schemaVersion: 1 | 2 = 2): ChangePlan {
  return createChangePlan("hash-1", "document-1", changes, [], { schemaVersion });
}

describe("buildPendingChangeCards", () => {
  it("builds nothing from no plan", () => {
    expect(buildPendingChangeCards(null, [])).toEqual([]);
  });

  it("names the rule and the risk in the heading", () => {
    // Spec §17: "House terminology · Low risk". The category is the user-facing
    // name of the rule, which is what a reader recognises.
    const subject = finding();
    const cards = buildPendingChangeCards(
      planWith([change({ findingId: subject.id, risk: "low" })]),
      [subject],
    );
    expect(cards[0]?.heading).toBe("language.terminology.preferred · low risk");
  });

  it("says the risk is unavailable rather than omitting it", () => {
    // A card that silently drops the field teaches the reader that ToneForge
    // assessed the risk when it did not.
    const cards = buildPendingChangeCards(planWith([change({ risk: undefined })]), []);
    expect(cards[0]?.heading).toContain("risk unavailable");
  });

  it("falls back to the change type when the plan has no finding for it", () => {
    const cards = buildPendingChangeCards(planWith([change()]), []);
    expect(cards[0]?.heading).toContain("replaceText");
  });

  it("counts paragraphs and sections from one, and shows a character offset as an index", () => {
    // A reader counts paragraphs from one; a character offset is an index and is
    // shown as one. Converting a text-window offset into a paragraph number
    // would produce a label that does not match the document.
    const cards = buildPendingChangeCards(
      planWith([
        change({ range: { start: 13, end: 18, unit: "paragraph" } }),
        change({ range: { start: 2, end: 4, unit: "section" } }),
        change({ range: { start: 4120, end: 4122, unit: "character" } }),
      ]),
      [],
    );
    expect(cards[0]?.location).toBe("Paragraph 14");
    expect(cards[1]?.location).toBe("Section 3");
    expect(cards[2]?.location).toBe("Character 4120");
  });

  it("takes before and after from the finding, not from the plan's payload", () => {
    const subject = finding();
    const cards = buildPendingChangeCards(
      // The payload disagrees with the finding on purpose: the card is showing
      // what the user approved, which is the finding.
      planWith([change({ findingId: subject.id, payload: { text: "DIFFERENT" } })]),
      [subject],
    );
    expect(cards[0]?.before).toBe("program");
    expect(cards[0]?.after).toBe("programme");
  });

  it("falls back to the change's own replacement when there is no finding", () => {
    const cards = buildPendingChangeCards(planWith([change()]), []);
    expect(cards[0]?.before).toBeNull();
    expect(cards[0]?.after).toBe("programme");
  });

  it("leaves the after text empty for a change that has none to state", () => {
    // A style application is named by the style, not by a string. Returning null
    // omits the row rather than printing "undefined".
    const cards = buildPendingChangeCards(
      planWith([change({ type: "applyStyle", payload: { styleName: "Heading 2" } })]),
      [],
    );
    expect(cards[0]?.after).toBeNull();
  });

  it("records whether the precondition held, which is what Apply refuses on", () => {
    // The loose change sits in a schema-version-1 plan, because version 2 refuses
    // to hold a change with no precondition at all. This is the shape a legacy
    // plan has, and the card has to report it rather than assume it away.
    const [held, loose] = buildPendingChangeCards(
      planWith([change(), change({ precondition: undefined })], 1),
      [],
    );
    expect(held?.preconditionHeld).toBe(true);
    expect(loose?.preconditionHeld).toBe(false);
  });

  it("offers navigation only where a finding exists to navigate to", () => {
    const subject = finding();
    const cards = buildPendingChangeCards(planWith([change({ findingId: subject.id }), change()]), [
      subject,
    ]);
    expect(cards[0]?.canNavigate).toBe(true);
    expect(cards[1]?.canNavigate).toBe(false);
  });

  it("keeps the plan's order, because that is the order Apply writes", () => {
    const changes = [change(), change(), change()];
    const cards = buildPendingChangeCards(planWith(changes), []);
    expect(cards.map((card) => card.changeId)).toEqual(changes.map((entry) => entry.id));
  });
});

describe("pendingChangeTotals", () => {
  it("counts what is listed as approved and the rest as awaiting review", () => {
    // Spec §17's footer: "14 approved / 3 awaiting review".
    expect(pendingChangeTotals(14, 17)).toEqual({ approved: 14, awaitingReview: 3 });
  });

  it("never reports a negative number of changes still to review", () => {
    // A caller cannot have reviewed more than was proposed. Rendering the
    // arithmetic literally would print "−3 awaiting review", which is a lie in
    // either direction; clamping is the honest floor.
    expect(pendingChangeTotals(5, 2).awaitingReview).toBe(0);
  });

  it("reports zero awaiting review when everything proposed was reviewed", () => {
    expect(pendingChangeTotals(4, 4)).toEqual({ approved: 4, awaitingReview: 0 });
  });
});
