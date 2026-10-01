/**
 * Protected-fact extraction.
 *
 * Three claims are under test, and the third is the one that decides whether
 * the whole thing is usable:
 *
 * 1. **Normalisation decides identity.** `£1,240,000` and `£1240000` are one
 *    figure; `30 June 2025` and `2025-06-30` are one date. A validator that
 *    disagrees would report a change on every sentence where the model
 *    formatted a figure slightly differently, and the user's response to that is
 *    to stop reading the warnings.
 * 2. **Overlapping matches are consumed.** `30 June 2025` must not also be read
 *    as the numbers 30 and 2025.
 * 3. **`certain` is calibrated.** A bare number and an unrecognised code are
 *    never certain, because the extractor cannot know what they are; a currency
 *    amount and a named month always are.
 */

import { describe, expect, it } from "vitest";

import {
  extractProtectedFacts,
  findFactsPresentIn,
  type ProtectedFactKind,
} from "../../../../src/analysis/semantic/protectedFacts";

function kinds(text: string): ProtectedFactKind[] {
  return extractProtectedFacts(text).map((fact) => fact.kind);
}

function values(text: string, kind: ProtectedFactKind): string[] {
  return extractProtectedFacts(text)
    .filter((fact) => fact.kind === kind)
    .map((fact) => fact.value);
}

describe("extractProtectedFacts", () => {
  it("reads a currency amount as one token, not a number", () => {
    const facts = extractProtectedFacts("The cost was £1,240,000 in total.");
    expect(facts.filter((fact) => fact.kind === "currency")).toHaveLength(1);
    // The number inside the amount must not also be reported as a bare quantity.
    expect(kinds("The cost was £1,240,000 in total.")).not.toContain("quantity");
  });

  it("treats separators and spacing as presentation, not as a change", () => {
    expect(values("£1,240,000", "currency")).toEqual(values("£1240000", "currency"));
    expect(values("£1,240,000", "currency")).not.toEqual(values("£1,240,500", "currency"));
  });

  it("normalises a date to an ordered triple, not a string", () => {
    const [named] = values("on 30 June 2025", "date");
    expect(named).toBe("date:2025-06-30");
    // Same date, two notations. A string comparison would call this a change.
    expect(values("on 2025-06-30", "date")).toEqual([named]);
    expect(values("on 18 July 2025", "date")).not.toEqual([named]);
  });

  it("claims a date before the quantity extractor can see its parts", () => {
    // One date, not three tokens. A duplicate report for a single change is a
    // report the user stops reading.
    const facts = extractProtectedFacts("on 30 June 2025");
    expect(facts).toHaveLength(1);
    expect(facts[0]?.kind).toBe("date");
  });

  it("reads a percentage and a duration as their own classes", () => {
    expect(kinds("That figure represents 4.2 % of the valuation.")).toEqual(["percentage"]);
    expect(values("4.2 %", "percentage")).toEqual(["percentage:4.2%"]);
    expect(values("4.2%", "percentage")).toEqual(["percentage:4.2%"]);
    expect(kinds("the activity finished 42 days late")).toContain("duration");
    expect(values("42 days", "duration")).toEqual(values("42 day", "duration"));
  });

  it("separates an activity reference from an event reference", () => {
    expect(kinds("recorded against event EVT-0087")).toEqual(["eventIdentifier"]);
    expect(kinds("The programme of works programmed ACT-0142")).toEqual(["activityIdentifier"]);
  });

  it("treats an unrecognised code as a soft identifier, not a confident one", () => {
    // `MX4471` might be a part number, a barcode, or a typo. Refusing a restyle
    // over one is how a validator becomes a thing users click past.
    const [fact] = extractProtectedFacts("part MX4471 was replaced");
    expect(fact?.kind).toBe("identifier");
    expect(fact?.certain).toBe(false);
  });

  it("reads a clause reference as one token including its keyword", () => {
    expect(values("under clause 12.4.3 that", "clauseReference")).toEqual([
      "clauseReference:clause 12.4.3",
    ]);
    // The bare number must not also be reported as a clause.
    expect(kinds("under clause 12.4.3 that")).not.toContain("quantity");
    expect(values("under clause 12.4.8 that", "clauseReference")).not.toEqual(
      values("under clause 12.4.3 that", "clauseReference"),
    );
  });

  it("recognises a party by its organisational suffix", () => {
    const [party] = extractProtectedFacts("The Contractor (Ardmore Construction Group) notified");
    expect(party?.kind).toBe("partyName");
    expect(party?.certain).toBe(true);
    expect(party?.value).toBe("partyName:ardmore construction group");
  });

  it("treats a party name case-insensitively but a figure exactly", () => {
    expect(values("Ardmore Construction Group", "partyName")).toEqual(
      values("ARDMORE CONSTRUCTION GROUP", "partyName"),
    );
    expect(values("4.2 %", "percentage")).not.toEqual(values("4.20 %", "percentage"));
  });

  it("does not claim a capitalised phrase at the start of a sentence as an entity", () => {
    // `The Contractor` and `The Programme` are capitalised two-word runs. A
    // checker that reported them as changed entities would warn on nearly every
    // paragraph an expert writes.
    expect(kinds("The Contractor contends that the delay was caused by design.")).not.toContain(
      "suspectedEntity",
    );
    expect(kinds("The programme of works programmed ACT-0142 for completion.")).not.toContain(
      "suspectedEntity",
    );
  });

  it("warns about a mid-sentence capitalised run it cannot classify", () => {
    const [fact] = extractProtectedFacts("The berth was used by Halvorsen Quay throughout.");
    expect(fact?.kind).toBe("suspectedEntity");
    // Soft, always: this is the specification's "could not verify that all named
    // entities were preserved".
    expect(fact?.certain).toBe(false);
  });

  it("never marks a bare number certain", () => {
    extractProtectedFacts("Clause 12 was applied to 7 items in room 3").forEach((fact) => {
      if (fact.kind === "quantity") expect(fact.certain).toBe(false);
    });
  });

  it("returns nothing for text with nothing protected in it", () => {
    expect(extractProtectedFacts("")).toEqual([]);
    expect(extractProtectedFacts("The delay was caused by late design information.")).toEqual([]);
  });

  it("is deterministic: the same text yields the same report", () => {
    const text = "ACT-0142 finished 42 days late on 30 June 2025 at a cost of £1,240,000.";
    expect(extractProtectedFacts(text)).toEqual(extractProtectedFacts(text));
  });

  it("reports positions that index back into the source text", () => {
    const text = "Cost: £1,240,000.";
    const [fact] = extractProtectedFacts(text);
    expect(text.slice(fact?.start, fact?.end)).toBe(fact?.surface);
  });

  it("extracts an appendix reference without confusing it with a clause", () => {
    expect(kinds("rests on the programme analysis at Appendix C")).toEqual(["documentReference"]);
  });
});

describe("findFactsPresentIn", () => {
  const sample = "The Contractor (Ardmore Construction Group) notified on 30 June 2025.";
  const facts = extractProtectedFacts(sample);

  it("finds a fact the text reproduces verbatim", () => {
    // The leakage check P2 needs: a model told not to repeat the sample may
    // still write the party name into a profile description.
    expect(
      findFactsPresentIn("the delay at Ardmore Construction Group was late", facts),
    ).toHaveLength(1);
  });

  it("finds a fact the text reproduces in a different notation", () => {
    expect(findFactsPresentIn("completed 2025-06-30", facts)).toHaveLength(1);
  });

  it("returns nothing for text that reproduces no protected token", () => {
    expect(
      findFactsPresentIn("the tone is restrained and the register professional", facts),
    ).toEqual([]);
  });

  it("locates the copy rather than returning the original's position", () => {
    // The report must point at where the leak is in the text being checked, or
    // the message that names it points at the wrong paragraph.
    const donor = extractProtectedFacts("The berth was used by Halvorsen Quay throughout.");
    const copy = "due to Halvorsen Quay";
    const [leaked] = findFactsPresentIn(copy, donor);
    expect(leaked?.surface).toBe("Halvorsen Quay");
    expect(copy.slice(leaked?.start, leaked?.end)).toBe("Halvorsen Quay");
  });
});
