import { describe, expect, it } from "vitest";
import type { ExpertReportClaim } from "../../../../src/analysis/consistency/contracts";
import { retrieveCandidates } from "../../../../src/analysis/consistency/candidates";
import { buildIndices } from "../../../../src/analysis/consistency/indices";
import {
  buildAliasIndex,
  collectAliasEntries,
  normaliseClaims,
} from "../../../../src/analysis/consistency/normalisation";
import { claim } from "../../../fixtures/consistencyClaims";

/**
 * R3 validation (plan §11): retrieval recall on the claim
 * fixtures.
 *
 * Each test asserts that the check whose rule names a
 * subject retrieves it from the indices — with no window
 * scanning and no forced claim pairs. C8 and C9 retrieve
 * on reference and section subjects: a citation and its
 * content are one subject, a heading and its section are
 * one subject, and neither is a pair of claims.
 */

/** Normalise, index, and run every check's retrieval. */
function retrieve(claims: ExpertReportClaim[], maxPerSubject = 400) {
  const normalised = normaliseClaims(claims);
  const aliases = buildAliasIndex(collectAliasEntries(claims));
  const indices = buildIndices(normalised);
  return retrieveCandidates({ indices, aliases, maxPerSubject });
}

/** The one candidate a check retrieved, when it retrieved one. */
function only(result: ReturnType<typeof retrieve>, checkId: string) {
  const candidates = result.candidates.filter((candidate) => candidate.checkId === checkId);
  expect(candidates).toHaveLength(1);
  return candidates[0];
}

describe("C1 terminology retrieval", () => {
  it("retrieves one entity asserted under multiple usages", () => {
    const result = retrieve([
      claim({
        id: "c-1",
        subjectIds: ["entity-works"],
        predicate: { text: "the works were delayed" },
      }),
      claim({
        id: "c-2",
        subjectIds: ["entity-works"],
        predicate: { text: "the works suffered disruption" },
      }),
    ]);
    expect(result.perCheck.C1).toBe(1);
    const candidate = only(result, "C1");
    expect(candidate?.subject).toEqual({
      kind: "entity",
      name: "entity-works",
      aliases: [],
    });
    expect(candidate?.claimIds).toEqual(["c-1", "c-2"]);
    expect(candidate?.retrieval.reasonCodes).toContain("multiple-usages");
    expect(candidate?.retrieval.sharedEntityIds).toEqual(["entity-works"]);
  });

  it("does not retrieve an entity whose usages all agree", () => {
    const result = retrieve([
      claim({
        id: "c-1",
        subjectIds: ["entity-works"],
        predicate: { text: "the works were delayed" },
      }),
      claim({
        id: "c-2",
        subjectIds: ["entity-works"],
        predicate: { text: "the works were delayed" },
      }),
    ]);
    expect(result.perCheck.C1).toBe(0);
  });

  it("retrieves an event two claims assert about", () => {
    const result = retrieve([
      claim({
        id: "c-1",
        eventIds: ["event-handover"],
        predicate: { text: "handover was delayed" },
      }),
      claim({
        id: "c-2",
        eventIds: ["event-handover"],
        predicate: { text: "handover slipped" },
      }),
    ]);
    expect(result.perCheck.C1).toBe(1);
    const candidate = only(result, "C1");
    expect(candidate?.subject).toEqual({
      kind: "event",
      description: "event-handover",
    });
  });
});

describe("C2 numeric retrieval", () => {
  it("retrieves one metric asserted twice in one context", () => {
    const result = retrieve([
      claim({
        id: "q-1",
        subjectIds: ["entity-works"],
        predicate: { text: "the prolongation cost" },
        values: [{ raw: "100000 USD", normalized: 100000 }],
      }),
      claim({
        id: "q-2",
        subjectIds: ["entity-works"],
        predicate: { text: "the prolongation cost" },
        values: [{ raw: "120000 USD", normalized: 120000 }],
      }),
    ]);
    expect(result.perCheck.C2).toBe(1);
    const candidate = only(result, "C2");
    expect(candidate?.subject).toEqual({
      kind: "quantum",
      measure: "the prolongation cost",
      unit: "",
    });
    expect(candidate?.claimIds).toEqual(["q-1", "q-2"]);
    expect(candidate?.retrieval.reasonCodes).toContain("compatible-context");
  });

  it("does not retrieve figures stated in different scenarios", () => {
    const result = retrieve([
      claim({
        id: "q-1",
        predicate: { text: "the prolongation cost" },
        scenario: { type: "primary" },
        values: [{ raw: "100000 USD", normalized: 100000 }],
      }),
      claim({
        id: "q-2",
        predicate: { text: "the prolongation cost" },
        scenario: { type: "alternative" },
        values: [{ raw: "120000 USD", normalized: 120000 }],
      }),
    ]);
    expect(result.perCheck.C2).toBe(0);
  });
});

describe("C3 temporal retrieval", () => {
  it("retrieves one event dated once and asserted twice", () => {
    const result = retrieve([
      claim({
        id: "t-1",
        eventIds: ["event-handover"],
        temporal: { eventDate: { raw: "1 April 2026", coarse: false } },
        predicate: { text: "handover was delayed" },
      }),
      claim({
        id: "t-2",
        eventIds: ["event-handover"],
        temporal: { eventDate: { raw: "1 April 2026", coarse: false } },
        predicate: { text: "handover slipped" },
      }),
    ]);
    expect(result.perCheck.C3).toBe(1);
    const candidate = only(result, "C3");
    expect(candidate?.subject).toEqual({
      kind: "event",
      description: "event-handover",
      temporal: "eventDate",
    });
    expect(candidate?.retrieval.reasonCodes).toContain("date-type:eventDate");
  });

  it("meets the same date written in two forms", () => {
    const result = retrieve([
      claim({
        id: "t-1",
        eventIds: ["event-handover"],
        temporal: { eventDate: { raw: "1 April 2026", coarse: false } },
        predicate: { text: "handover was delayed" },
      }),
      claim({
        id: "t-2",
        eventIds: ["event-handover"],
        temporal: { eventDate: { raw: "2026-04-01", coarse: false } },
        predicate: { text: "handover slipped" },
      }),
    ]);
    expect(result.perCheck.C3).toBe(1);
  });

  it("keeps date roles apart: an event date is not a reporting date", () => {
    const result = retrieve([
      claim({
        id: "t-1",
        eventIds: ["event-handover"],
        temporal: { eventDate: { raw: "1 April 2026", coarse: false } },
        predicate: { text: "handover was delayed" },
      }),
      claim({
        id: "t-2",
        eventIds: ["event-handover"],
        temporal: {
          reportingDate: { raw: "1 April 2026", coarse: false },
        },
        predicate: { text: "handover was reported" },
      }),
    ]);
    expect(result.perCheck.C3).toBe(0);
  });
});

describe("C4 entity attribute retrieval", () => {
  it("retrieves one attribute under a changing programme", () => {
    const result = retrieve([
      claim({
        id: "c-1",
        subjectIds: ["entity-works"],
        programmeIds: ["programme-baseline"],
        predicate: { text: "the works were delayed" },
      }),
      claim({
        id: "c-2",
        subjectIds: ["entity-works"],
        programmeIds: ["programme-revised"],
        predicate: { text: "the works were delayed" },
      }),
    ]);
    expect(result.perCheck.C4).toBe(1);
    const candidate = only(result, "C4");
    expect(candidate?.subject.kind).toBe("entity");
    expect(candidate?.retrieval.reasonCodes).toContain("changing-programme");
  });
});

describe("C5 definition retrieval", () => {
  it("retrieves a defined term together with its usage", () => {
    const result = retrieve([
      claim({
        id: "d-1",
        predicate: {
          text: "handover means the date the works are completed",
          kind: "definition",
        },
      }),
      claim({
        id: "u-1",
        predicate: { text: "the handover was confirmed" },
      }),
    ]);
    expect(result.perCheck.C5).toBe(1);
    const candidate = only(result, "C5");
    expect(candidate?.subject).toEqual({
      kind: "term",
      term: "handover",
    });
    expect(candidate?.claimIds).toEqual(["d-1", "u-1"]);
    expect(candidate?.retrieval.reasonCodes).toContain("term-usage");
  });
});

describe("C6 unit retrieval", () => {
  it("retrieves one measure stated in convertible units", () => {
    const result = retrieve([
      claim({
        id: "m-1",
        predicate: { text: "the delay was measured" },
        values: [{ raw: "2 weeks", normalized: 2, unit: "weeks" }],
      }),
      claim({
        id: "m-2",
        predicate: { text: "the delay was measured" },
        values: [{ raw: "14 days", normalized: 14, unit: "days" }],
      }),
    ]);
    expect(result.perCheck.C6).toBe(1);
    const candidate = only(result, "C6");
    expect(candidate?.subject.kind).toBe("quantum");
    expect(candidate?.retrieval.reasonCodes).toContain("convert-units");
  });

  it("does not retrieve values in units that do not convert", () => {
    const result = retrieve([
      claim({
        id: "m-1",
        predicate: { text: "the delay was measured" },
        values: [{ raw: "2 weeks", normalized: 2, unit: "weeks" }],
      }),
      claim({
        id: "m-2",
        predicate: { text: "the delay was measured" },
        values: [{ raw: "14 kg", normalized: 14, unit: "kg" }],
      }),
    ]);
    expect(result.perCheck.C6).toBe(0);
  });
});

describe("C7 status retrieval", () => {
  it("retrieves one entity with potentially exclusive states", () => {
    const result = retrieve([
      claim({
        id: "c-1",
        subjectIds: ["entity-activity"],
        predicate: { text: "the activity is enabled" },
      }),
      claim({
        id: "c-2",
        subjectIds: ["entity-activity"],
        predicate: { text: "the activity is disabled" },
      }),
    ]);
    expect(result.perCheck.C7).toBe(1);
    const candidate = only(result, "C7");
    expect(candidate?.subject.kind).toBe("entity");
    expect(candidate?.retrieval.reasonCodes).toContain("exclusive-status");
  });

  it("does not retrieve states that can both hold", () => {
    const result = retrieve([
      claim({
        id: "c-1",
        subjectIds: ["entity-activity"],
        predicate: { text: "the activity is enabled" },
      }),
      claim({
        id: "c-2",
        subjectIds: ["entity-activity"],
        predicate: { text: "the activity is complete" },
      }),
    ]);
    expect(result.perCheck.C7).toBe(0);
  });
});

describe("C8 reference retrieval", () => {
  it("retrieves a citation and its content as one subject", () => {
    const result = retrieve([
      claim({
        id: "r-1",
        documentRefIds: ["doc-contract"],
        predicate: { text: "see clause 12.3" },
      }),
      claim({
        id: "r-2",
        documentRefIds: ["doc-contract"],
        predicate: { text: "clause 12.3 governs handover" },
      }),
    ]);
    expect(result.perCheck.C8).toBe(1);
    const candidate = only(result, "C8");
    // The subject is the citation, not a claim pair.
    expect(candidate?.subject).toEqual({
      kind: "reference",
      citation: "doc-contract",
    });
    expect(candidate?.claimIds).toEqual(["r-1", "r-2"]);
  });

  it("does not retrieve claims that cite nothing", () => {
    const result = retrieve([claim({ id: "r-1", predicate: { text: "the works were delayed" } })]);
    expect(result.perCheck.C8).toBe(0);
  });
});

describe("C9 section promise retrieval", () => {
  it("retrieves a section and the content indexed under it", () => {
    const result = retrieve([
      claim({
        id: "s-1",
        predicate: { text: "the works were delayed" },
      }),
      claim({
        id: "s-2",
        predicate: { text: "the works suffered disruption" },
      }),
    ]);
    expect(result.perCheck.C9).toBe(1);
    const candidate = only(result, "C9");
    // The subject is the section, not a claim pair.
    expect(candidate?.subject).toEqual({
      kind: "section",
      heading: "Programme",
    });
    expect(candidate?.claimIds).toEqual(["s-1", "s-2"]);
  });

  it("keys a section by its full heading path", () => {
    const result = retrieve([
      claim({
        id: "s-1",
        predicate: { text: "the works were delayed" },
        evidence: {
          documentId: "doc-fixture",
          sectionPath: ["Programme", "Delay"],
          paragraphId: "p-1",
          startOffset: 0,
          endOffset: 1,
          exactText: "x",
          evidenceHash: "hash",
        },
      }),
    ]);
    expect(result.perCheck.C9).toBe(1);
    const candidate = only(result, "C9");
    expect(candidate?.subject).toEqual({
      kind: "section",
      heading: "Programme > Delay",
    });
  });
});

describe("C10 scope retrieval", () => {
  it("retrieves a universal claim with a plausible exception", () => {
    const result = retrieve([
      claim({
        id: "s-1",
        scope: { kind: "universal", description: "all work" },
        predicate: { text: "all work is subject to the contract" },
      }),
      claim({
        id: "s-2",
        scope: { kind: "exception", description: "excepted items" },
        predicate: {
          text: "excepted items are not subject to the contract",
        },
      }),
    ]);
    expect(result.perCheck.C10).toBe(1);
    const candidate = only(result, "C10");
    expect(candidate?.retrieval.reasonCodes).toContain("plausible-exception");
    expect(candidate?.claimIds).toEqual(["s-1", "s-2"]);
  });

  it("does not retrieve a universal claim with no plausible exception", () => {
    const result = retrieve([
      claim({
        id: "s-1",
        scope: { kind: "universal", description: "all work" },
        predicate: { text: "all work is subject to the contract" },
      }),
    ]);
    expect(result.perCheck.C10).toBe(0);
  });
});

describe("blocking caps", () => {
  it("caps a subject at the per-subject budget and counts the rest", () => {
    const result = retrieve(
      [
        claim({
          id: "c-1",
          subjectIds: ["entity-works"],
          predicate: { text: "the works were delayed" },
        }),
        claim({
          id: "c-2",
          subjectIds: ["entity-works"],
          predicate: { text: "the works suffered disruption" },
        }),
        claim({
          id: "c-3",
          subjectIds: ["entity-works"],
          predicate: { text: "the works were accelerated" },
        }),
      ],
      1,
    );
    expect(result.perCheck.C1).toBe(1);
    const candidate = only(result, "C1");
    expect(candidate?.claimIds).toEqual(["c-1"]);
    expect(result.blockOverflowSkipped).toBeGreaterThan(0);
  });
});

describe("retrieval registry", () => {
  it("dispatches all ten checks", () => {
    const result = retrieve([]);
    ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"].forEach((checkId) => {
      expect(result.perCheck[checkId]).toBe(0);
    });
  });

  it("is deterministic: the same claims retrieve the same candidates", () => {
    const claims = [
      claim({
        id: "c-1",
        subjectIds: ["entity-works"],
        predicate: { text: "the works were delayed" },
      }),
      claim({
        id: "c-2",
        subjectIds: ["entity-works"],
        predicate: { text: "the works suffered disruption" },
      }),
    ];
    const first = retrieve(claims);
    const second = retrieve(claims);
    expect(second.candidates.map(({ fingerprint }) => fingerprint)).toEqual(
      first.candidates.map(({ fingerprint }) => fingerprint),
    );
  });
});
