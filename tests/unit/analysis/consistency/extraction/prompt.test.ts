import { describe, expect, it } from "vitest";
import { buildExtractionBatches } from "../../../../../src/analysis/consistency/extraction/batch";
import {
  buildExtractionPrompt,
  ExtractionResponseSchema,
} from "../../../../../src/analysis/consistency/extraction/prompt";
import type { ConsistencyDocument } from "../../../../../src/analysis/consistency/contracts";

/**
 * R2 prompt tests: the prompt is gated on the raw-text
 * opt-in, encodes the ten extraction rules, declares the
 * strict response schema, and carries the batch's section
 * hierarchy and paragraph ids.
 */
const DOCUMENT: ConsistencyDocument = {
  revision: "doc-prompt",
  text: "## Programme\n\nThe contractor reported a six-week delay.",
  sections: ["Programme"],
};

function firstBatch() {
  const batches = buildExtractionBatches(DOCUMENT);
  const first = batches[0];
  if (first === undefined) {
    throw new Error("the fixture document has no batches");
  }
  return first;
}

describe("the extraction prompt", () => {
  it("refuses to build without the raw-text opt-in", () => {
    expect(() => buildExtractionPrompt(firstBatch())).toThrow(/includeRawText: true/);
  });

  it("encodes the ten prompt rules", () => {
    const prompt = buildExtractionPrompt(firstBatch(), {
      includeRawText: true,
    });
    expect(prompt).toContain("atomic proposition");
    expect(prompt).toContain("Attribute every claim exactly");
    expect(prompt).toContain("reported party positions");
    expect(prompt).toContain("scenarios separate");
    expect(prompt).toContain("modality");
    expect(prompt).toContain("programme revision");
    expect(prompt).toContain("basis of every delay");
    expect(prompt).toContain("exact evidence");
    expect(prompt).toContain("unknown rather than guessing");
    expect(prompt).toContain("no fact the text does not support");
  });

  it("carries the section hierarchy and the stable paragraph ids", () => {
    const prompt = buildExtractionPrompt(firstBatch(), {
      includeRawText: true,
    });
    expect(prompt).toContain("Section: Programme");
    expect(prompt).toContain("[p-1-0] The contractor reported a six-week delay.");
  });

  it("declares the claim class vocabulary so the model cannot invent values", () => {
    const prompt = buildExtractionPrompt(firstBatch(), {
      includeRawText: true,
    });
    expect(prompt).toContain("FACT_ASSERTION");
    expect(prompt).toContain("REFERENCE");
    expect(prompt).toContain("reported_party_position");
  });

  it("tells the model that ToneForge assigns ids, offsets, and hashes", () => {
    const prompt = buildExtractionPrompt(firstBatch(), {
      includeRawText: true,
    });
    expect(prompt).toContain(
      "Do not invent ids, offsets, or hashes: ToneForge assigns them after validation.",
    );
  });

  it("names the opening section when the batch has no title", () => {
    const batches = buildExtractionBatches({
      revision: "doc-prompt",
      text: "Opening text.",
      sections: [],
    });
    const opening = batches[0];
    if (opening === undefined) {
      throw new Error("the opening document has no batches");
    }
    const prompt = buildExtractionPrompt(opening, { includeRawText: true });
    expect(prompt).toContain("Section: (opening text)");
    expect(prompt).toContain("Section path: (root)");
  });
});

describe("the extraction response schema", () => {
  it("parses a minimal raw claim", () => {
    const parsed = ExtractionResponseSchema.parse({
      claims: [
        {
          claimClass: "FACT_ASSERTION",
          predicate: "the contractor reported a delay",
          speaker: { id: "party-1", name: "The Contractor" },
          polarity: "positive",
          evidence: { paragraphId: "p-1-0", exactText: "a delay" },
        },
      ],
    });
    expect(parsed.claims[0]?.claimClass).toBe("FACT_ASSERTION");
    expect(parsed.claims[0]?.evidence.paragraphId).toBe("p-1-0");
  });

  it("rejects an unknown claim class", () => {
    expect(() =>
      ExtractionResponseSchema.parse({
        claims: [
          {
            claimClass: "OPINION",
            predicate: "a claim",
            speaker: { id: "party-1", name: "The Contractor" },
            polarity: "positive",
            evidence: { paragraphId: "p-1-0", exactText: "a delay" },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects a claim without evidence", () => {
    expect(() =>
      ExtractionResponseSchema.parse({
        claims: [
          {
            claimClass: "FACT_ASSERTION",
            predicate: "a claim",
            speaker: { id: "party-1", name: "The Contractor" },
            polarity: "positive",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects an empty evidence quote", () => {
    expect(() =>
      ExtractionResponseSchema.parse({
        claims: [
          {
            claimClass: "FACT_ASSERTION",
            predicate: "a claim",
            speaker: { id: "party-1", name: "The Contractor" },
            polarity: "positive",
            evidence: { paragraphId: "p-1-0", exactText: "   " },
          },
        ],
      }),
    ).toThrow();
  });

  it("strips keys the schema does not declare", () => {
    const parsed = ExtractionResponseSchema.parse({
      claims: [
        {
          claimClass: "FACT_ASSERTION",
          predicate: "a claim",
          speaker: { id: "party-1", name: "The Contractor" },
          polarity: "positive",
          evidence: { paragraphId: "p-1-0", exactText: "a delay" },
          invented: true,
        },
      ],
    });
    expect(parsed.claims[0]).not.toHaveProperty("invented");
  });

  it("accepts a claim with every optional facet populated", () => {
    const parsed = ExtractionResponseSchema.parse({
      claims: [
        {
          claimClass: "FACT_ASSERTION",
          predicate: "a claim",
          speaker: { id: "party-1", name: "The Contractor" },
          attributedTo: { id: "party-2", name: "The Employer" },
          adoptionStatus: "reported_party_position",
          polarity: "negative",
          subjectIds: ["subject-1"],
          temporal: {
            eventDate: { raw: "1 April 2026", iso: "2026-04-01" },
          },
          values: [{ raw: "1,250,000 USD", normalized: 1250000, currency: "USD" }],
          scope: { kind: "universal" },
          delay: { durationText: "six weeks", durationDays: 42 },
          quantum: { amount: 1250000, currency: "USD", basis: "nominal" },
          causation: { assertedCause: "the delay", assertedEffect: "the loss" },
          responsibility: {
            party: { id: "party-2", name: "The Employer" },
            allocation: "fully",
          },
          contractualBasis: [{ reference: "clause 12.3" }],
          modality: "assertion",
          qualifiers: [{ text: "approximately" }],
          assertionStrength: "definitive",
          scenario: { type: "primary" },
          evidence: { paragraphId: "p-1-0", exactText: "a delay" },
        },
      ],
    });
    expect(parsed.claims[0]?.delay?.durationDays).toBe(42);
    expect(parsed.claims[0]?.quantum?.basis).toBe("nominal");
  });
});
