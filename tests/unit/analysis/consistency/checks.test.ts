import { describe, expect, it } from "vitest";
import {
  checkDefinitionalConflict,
  checkEntityAttributeConflict,
  checkNumericContradiction,
  checkReferenceConflict,
  checkScopeContradiction,
  checkSectionPromiseMismatch,
  checkStatusContradiction,
  checkTemporalConflict,
  checkTerminologyDrift,
  checkUnitInconsistency,
  CONSISTENCY_CHECKERS,
  checkerFor,
  type IndexedStatement,
} from "../../../../src/analysis/consistency/checks";
import { extractCitations } from "../../../../src/analysis/consistency/checks/semantic";
import { promisedContent } from "../../../../src/analysis/consistency/checks/structural";
import {
  compareDates,
  extractDates,
  extractQuantities,
  splitSentences,
  valueKey,
} from "../../../../src/analysis/consistency/checks/primitives";

/**
 * Each check gets a positive case (the conflict it exists to find) and, more
 * importantly, a negative case. A check that fires on everything is worse than
 * one that fires on nothing: a user who learns that a check always reports a
 * problem stops reading it.
 */

let counter = 0;

function statement(text: string, section = "", index?: number): IndexedStatement {
  const at = index ?? counter++;
  return {
    statement: { id: `s${at}`, section, text, start: 0, end: text.length },
    index: at,
  };
}

function reset(): void {
  counter = 0;
}

describe("primitives", () => {
  it("splits sentences and drops empties", () => {
    expect(splitSentences("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
    expect(splitSentences("   ")).toEqual([]);
  });

  it("normalizes a value so thousands separators do not create a difference", () => {
    expect(valueKey("12,000")).toBe(valueKey("12000"));
  });

  it("extracts a quantity with its unit and resolved value", () => {
    const [quantity] = extractQuantities("Revenue reached 5k last year.");
    expect(quantity?.value).toBe(5);
    expect(quantity?.unit).toBe("k");
    // 5k must resolve to 5000, or C6 could not tell a unit mismatch from a
    // value mismatch.
    expect(quantity?.normalized).toBe(5000);
  });

  it("leaves an unrecognized suffix as the unit rather than guessing", () => {
    const [quantity] = extractQuantities("We planted 5 apples.");
    expect(quantity?.unit).toBe("apples");
    expect(quantity?.normalized).toBe(5);
  });

  it("reads an ISO date", () => {
    const [date] = extractDates("Launch was 2026-03-04.");
    expect(date?.year).toBe(2026);
    expect(date?.month).toBe(3);
    expect(date?.day).toBe(4);
  });

  it("reads a long-form date", () => {
    const [date] = extractDates("Launch was 4 March 2026.");
    expect(date?.year).toBe(2026);
    expect(date?.month).toBe(3);
    expect(date?.day).toBe(4);
  });

  it("reads a month and year as a coarse date with day zero", () => {
    const [date] = extractDates("Launch was March 2026.");
    expect(date?.day).toBe(0);
  });

  it("calls two different precise years a conflict", () => {
    const [a] = extractDates("On 2026-03-04.");
    const [b] = extractDates("On 2025-01-01.");
    expect(compareDates(a!, b!)).toBe("conflict");
  });

  it("calls a coarse date in the same month as a precise one incomparable", () => {
    // "March 2026" and "4 March 2026" are not the same day, but they are not in
    // conflict either — the coarse date is still true of the precise one.
    const [coarse] = extractDates("Launch was March 2026.");
    const [precise] = extractDates("Launch was 4 March 2026.");
    expect(compareDates(coarse!, precise!)).toBe("incomparable");
  });

  it("calls a coarse date in a different month a conflict", () => {
    // The rule is not "a coarse date is never a conflict". March and April are
    // different months, and a coarse date that names one of them does contradict
    // a precise date naming the other.
    const [coarse] = extractDates("Launch was March 2026.");
    const [precise] = extractDates("Launch was 4 April 2026.");
    expect(compareDates(coarse!, precise!)).toBe("conflict");
  });

  it("calls the same date a match", () => {
    const [a] = extractDates("On 2026-03-04.");
    const [b] = extractDates("Also on 2026-03-04.");
    expect(compareDates(a!, b!)).toBe("same");
  });

  it("extracts a citation with its key and year", () => {
    const [citation] = extractCitations("As Smith (2019) shows, this holds.");
    expect(citation?.key).toBe("smith");
    expect(citation?.year).toBe(2019);
  });

  it("extracts a numbered citation", () => {
    const [citation] = extractCitations("Prior work [12] suggests otherwise.");
    expect(citation?.key).toBe("[12]");
  });

  it("recognizes a heading that promises a kind of content", () => {
    expect(promisedContent("Key Figures")).toBe("numbers");
    expect(promisedContent("Project Timeline")).toBe("dates");
  });

  it("returns null for a heading that promises nothing recognizable", () => {
    expect(promisedContent("Miscellaneous")).toBeNull();
  });
});

describe("the checker registry", () => {
  it("registers exactly ten checkers", () => {
    expect(CONSISTENCY_CHECKERS).toHaveLength(10);
  });

  it("registers one checker per check id, in order", () => {
    expect(CONSISTENCY_CHECKERS.map((checker) => checker.id)).toEqual([
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
      "C6",
      "C7",
      "C8",
      "C9",
      "C10",
    ]);
  });

  it("resolves a checker by id and refuses an unregistered one", () => {
    expect(checkerFor("C1").id).toBe("C1");
    expect(() => checkerFor("C99" as never)).toThrow(/No checker/);
  });
});

describe("quantity extraction", () => {
  it("reads a minus sign as a negative sign", () => {
    const [quantity] = extractQuantities("Revenue fell by -5 million.");
    expect(quantity?.value).toBe(-5);
  });

  it("does not read a hyphen inside an identifier as a negative sign", () => {
    // "COVID-19" is a name, not a claim of -19. Reading the hyphen as a minus
    // made identifiers look like negative quantities, and two documents naming
    // different identifiers contradicted each other on figures nobody wrote.
    const found = extractQuantities("The variant is COVID-19.");
    expect(found.map((quantity) => quantity.value)).toEqual([19]);
  });

  it("excludes the digits inside a date rather than reading them as quantities", () => {
    // The digits of a date belong to that date. Read as quantities they became
    // "2026" and "-03" and "-04", and C2 then compared one statement's date
    // against another statement's date and called the difference a figure
    // conflict the author never wrote.
    expect(extractQuantities("The migration completed on 2026-03-04.")).toHaveLength(0);
    expect(extractQuantities("The migration completed in March 2026.")).toHaveLength(0);
    expect(extractQuantities("The migration completed on 4 March 2026.")).toHaveLength(0);
  });
});

describe("C1 terminology drift", () => {
  it("finds the same subject called by different names across sections", () => {
    reset();
    const found = checkTerminologyDrift([
      statement("The onboarding programme helps new staff learn the system quickly.", "Intro"),
      statement("The onboarding program helps new staff learn the system quickly.", "Detail"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.checkId).toBe("C1");
  });

  it("treats a one-sided addition as ambiguous rather than a decided naming conflict", () => {
    // One unique word in total is not a substitution. One statement simply says
    // more than the other, and calling that terminology drift reports a
    // difference the author never made.
    reset();
    const found = checkTerminologyDrift([
      statement("The onboarding programme helps new staff learn the system.", "Intro"),
      statement("The onboarding programme helps new staff learn the system quickly.", "Detail"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.certainty).toBe("ambiguous");
  });

  it("stays silent when two sections use the same wording", () => {
    reset();
    const found = checkTerminologyDrift([
      statement("The onboarding programme helps new staff learn the system.", "Intro"),
      statement("The onboarding programme helps new staff learn the system.", "Detail"),
    ]);
    expect(found).toHaveLength(0);
  });

  it("stays silent for unrelated sentences", () => {
    reset();
    const found = checkTerminologyDrift([
      statement("The budget was approved in March.", "Intro"),
      statement("Photographs were taken at the summit.", "Detail"),
    ]);
    expect(found).toHaveLength(0);
  });

  it("ignores drift within a single section", () => {
    reset();
    const found = checkTerminologyDrift([
      statement("The onboarding programme helps new staff.", "Intro"),
      statement("The onboarding program helps new staff.", "Intro"),
    ]);
    expect(found).toHaveLength(0);
  });

  it("sends a one-for-one swap that is not a spelling variant to adjudication", () => {
    // "north" and "south" have the same shape as "programme" and "program" —
    // one unique word each side, shared subject, different sections — but they
    // are two places, not two spellings of one. Reporting that as a decided
    // naming conflict is a wrong answer rather than a question, so it stays
    // ambiguous and the model weighs it.
    reset();
    const found = checkTerminologyDrift([
      statement("The northern office reports to the regional director each week.", "Intro"),
      statement("The southern office reports to the regional director each week.", "Detail"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.certainty).toBe("ambiguous");
  });
});

describe("C2 numeric contradiction", () => {
  it("finds the same quantity given two values", () => {
    reset();
    const found = checkNumericContradiction([
      statement("The quarterly revenue target is 4 million.", "Intro"),
      statement("The quarterly revenue target is 5 million.", "Detail"),
    ]);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.checkId).toBe("C2");
  });

  it("treats thousands separators as the same value", () => {
    reset();
    const found = checkNumericContradiction([
      statement("The headcount target is 12000.", "Intro"),
      statement("The headcount target is 12,000.", "Detail"),
    ]);
    expect(found).toHaveLength(0);
  });

  it("leaves different units to C6 rather than reporting a value conflict", () => {
    reset();
    const found = checkNumericContradiction([
      statement("The headcount target is 5000 people.", "Intro"),
      statement("The headcount target is 5k people.", "Detail"),
    ]);
    expect(found).toHaveLength(0);
  });

  it("does not raise a candidate from the dates alone", () => {
    // These are C3's fixtures. C2 saw their digits as quantities and reported a
    // figure contradiction between two statements that differ only in when the
    // same event happened — a duplicate of the temporal finding, arrived at by
    // treating a date as a set of numbers.
    reset();
    const found = checkNumericContradiction([
      statement("The migration completed on 2026-03-04.", "Intro"),
      statement("The migration completed on 2026-05-09.", "Detail"),
    ]);
    expect(found).toHaveLength(0);
  });

  it("stays silent when the numbers belong to different subjects", () => {
    reset();
    const found = checkNumericContradiction([
      statement("Revenue was 4 million.", "Intro"),
      statement("Headcount was 300.", "Detail"),
    ]);
    expect(found).toHaveLength(0);
  });

  it("reports at most one candidate per statement pair however many numbers each has", () => {
    // A cross-product of quantities produced several candidates for the same two
    // statements, all with the same fingerprint, so one conflict was reported
    // repeatedly with no way to tell which pair of figures was in dispute.
    reset();
    const found = checkNumericContradiction([
      statement("Revenue was 4 million in the north and 6 million in the south.", "Intro"),
      statement("Revenue was 5 million in the north and 7 million in the south.", "Detail"),
    ]);
    expect(found).toHaveLength(1);
  });
});

describe("C3 temporal conflict", () => {
  it("finds the same subject placed on two different dates", () => {
    reset();
    const found = checkTemporalConflict([
      statement("The migration completed on 2026-03-04.", "Intro"),
      statement("The migration completed on 2026-05-09.", "Detail"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.checkId).toBe("C3");
  });

  it("does not report a coarse date against a precise date in the same month", () => {
    reset();
    const found = checkTemporalConflict([
      statement("The migration completed in March 2026.", "Intro"),
      statement("The migration completed on 2026-03-09.", "Detail"),
    ]);
    expect(found).toHaveLength(0);
  });

  it("does report a coarse date against a precise date in a different month", () => {
    reset();
    const found = checkTemporalConflict([
      statement("The migration completed in March 2026.", "Intro"),
      statement("The migration completed on 2026-05-09.", "Detail"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.certainty).toBe("certain");
  });

  it("leaves a multi-date statement ambiguous rather than certain", () => {
    // With several dates on each side, "some pair conflicts" does not say which
    // claim is the contradictory one.
    reset();
    const found = checkTemporalConflict([
      statement("The migration started 2026-01-05 and completed 2026-03-04.", "Intro"),
      statement("The migration started 2026-01-05 and completed 2026-07-19.", "Detail"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.certainty).toBe("ambiguous");
  });

  it("stays silent for the same date stated twice", () => {
    reset();
    const found = checkTemporalConflict([
      statement("The migration completed on 2026-03-04.", "Intro"),
      statement("The migration completed on 2026-03-04.", "Detail"),
    ]);
    expect(found).toHaveLength(0);
  });
});

describe("C4 entity attribute conflict", () => {
  it("produces an ambiguous candidate for a shared entity", () => {
    reset();
    const found = checkEntityAttributeConflict([
      statement("Acme was founded in 1998 and is a manufacturer.", "Intro"),
      statement("Acme is a software company with offices overseas.", "Detail"),
    ]);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.checkId).toBe("C4");
  });

  it("always marks its candidates ambiguous, never certain", () => {
    // A certainty here would let an unverified guess reach the planner as a
    // decided conflict.
    reset();
    const found = checkEntityAttributeConflict([
      statement("Acme was founded in 1998 and is a manufacturer.", "Intro"),
      statement("Acme is a software company with offices overseas.", "Detail"),
    ]);
    found.forEach((candidate) => expect(candidate.certainty).toBe("ambiguous"));
  });

  it("does not treat a sentence-initial article as a shared entity", () => {
    // "The" is capitalized at the start of a sentence and is not a proper noun.
    // Without the exclusion, every pair of sentences beginning with an article
    // anchors C4 and the check fires on the whole document.
    reset();
    const found = checkEntityAttributeConflict([
      statement("The budget was approved in March.", "Intro"),
      statement("The photographs were taken at the summit.", "Detail"),
    ]);
    expect(found).toHaveLength(0);
  });

  it("stays silent with no shared proper noun", () => {
    reset();
    const found = checkEntityAttributeConflict([
      statement("Revenue was 4 million.", "Intro"),
      statement("Headcount was 300.", "Detail"),
    ]);
    expect(found).toHaveLength(0);
  });
});

describe("C5 definitional conflict", () => {
  it("finds a term defined twice", () => {
    reset();
    const found = checkDefinitionalConflict([
      statement("Latency is defined as the time to first byte.", "Intro"),
      statement("Latency means the total round trip time.", "Detail"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.checkId).toBe("C5");
  });

  it("ignores definitions of different terms", () => {
    reset();
    const found = checkDefinitionalConflict([
      statement("Latency is defined as the time to first byte.", "Intro"),
      statement("Throughput means requests per second.", "Detail"),
    ]);
    expect(found).toHaveLength(0);
  });
});

describe("C6 unit inconsistency", () => {
  it("finds the same figure written in two units", () => {
    reset();
    const found = checkUnitInconsistency([
      statement("The budget is 5k dollars.", "Intro"),
      statement("The budget is 5000 dollars.", "Detail"),
    ]);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.checkId).toBe("C6");
  });

  it("stays silent when the same unit is used twice", () => {
    reset();
    const found = checkUnitInconsistency([
      statement("The budget is 5000 dollars.", "Intro"),
      statement("The budget is 6000 dollars.", "Detail"),
    ]);
    expect(found).toHaveLength(0);
  });
});

describe("C7 status contradiction", () => {
  it("finds mutually exclusive states about one subject", () => {
    reset();
    const found = checkStatusContradiction([
      statement("The review workflow is enabled for this team.", "Intro"),
      statement("The review workflow is disabled for this team.", "Detail"),
    ]);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.checkId).toBe("C7");
  });

  it("stays silent when both statements agree", () => {
    reset();
    const found = checkStatusContradiction([
      statement("The review workflow is enabled for this team.", "Intro"),
      statement("The review workflow is also enabled.", "Detail"),
    ]);
    expect(found).toHaveLength(0);
  });
});

describe("C8 reference conflict", () => {
  it("finds one source cited with two years", () => {
    reset();
    const found = checkReferenceConflict([
      statement("Smith (2019) shows that the effect persists.", "Intro"),
      statement("Smith (2021) shows that the effect persists.", "Detail"),
    ]);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.checkId).toBe("C8");
  });

  it("stays silent for the same source and year twice", () => {
    reset();
    const found = checkReferenceConflict([
      statement("Smith (2019) shows that the effect persists.", "Intro"),
      statement("Smith (2019) also shows that the effect persists.", "Detail"),
    ]);
    expect(found).toHaveLength(0);
  });
});

describe("C9 section promise mismatch", () => {
  it("flags a section that lacks what its heading promises", () => {
    reset();
    const body = statement("Revenue was strong across every region we operate in.", "Key Figures");
    const found = checkSectionPromiseMismatch([body], ["Key Figures"]);
    expect(found).toHaveLength(1);
    expect(found[0]?.checkId).toBe("C9");
  });

  it("stays silent when the section does contain what it promises", () => {
    reset();
    const body = statement("The key figures are 4 million and 5 million.", "Key Figures");
    expect(checkSectionPromiseMismatch([body], ["Key Figures"])).toHaveLength(0);
  });

  it("accepts a section that states numbers without repeating the word in its heading", () => {
    // "Key Figures" is satisfied by the figures themselves. Requiring the marker
    // word in the body reported a section full of numbers as having none.
    reset();
    const body = statement("Revenue reached 4 million across the region.", "Key Figures");
    expect(checkSectionPromiseMismatch([body], ["Key Figures"])).toHaveLength(0);
  });

  it("accepts a section that states dates without repeating the word in its heading", () => {
    reset();
    const body = statement("The launch happened on 2026-03-04.", "Project Timeline");
    expect(checkSectionPromiseMismatch([body], ["Project Timeline"])).toHaveLength(0);
  });

  it("ignores a heading that promises nothing recognizable", () => {
    reset();
    const body = statement("Anything at all.", "Miscellaneous");
    expect(checkSectionPromiseMismatch([body], ["Miscellaneous"])).toHaveLength(0);
  });

  it("ignores a heading with no body rather than calling it a mismatch", () => {
    // An empty section is a different problem from a misleading one.
    reset();
    expect(checkSectionPromiseMismatch([], ["Key Figures"])).toHaveLength(0);
  });
});

describe("C10 scope contradiction", () => {
  it("finds a universal claim beside an exception", () => {
    reset();
    const found = checkScopeContradiction([
      statement("All regions are covered by the service.", "Intro"),
      statement("Every region is covered, however three are not yet.", "Detail"),
    ]);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.checkId).toBe("C10");
  });

  it("detects the universal 'always', which singular folding would have hidden", () => {
    reset();
    const found = checkScopeContradiction([
      statement("The service always encrypts customer records at rest.", "Intro"),
      statement(
        "The service encrypts customer records at rest, however some archives are not.",
        "Detail",
      ),
    ]);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.checkId).toBe("C10");
  });

  it("stays silent for a hedged statement with no universal beside it", () => {
    reset();
    const found = checkScopeContradiction([
      statement("Revenue was strong in the northern region.", "Intro"),
      statement("Costs rose in the southern region.", "Detail"),
    ]);
    expect(found).toHaveLength(0);
  });
});
