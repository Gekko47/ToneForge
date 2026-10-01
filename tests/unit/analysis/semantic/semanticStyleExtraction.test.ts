/**
 * The strict extraction schema and the three refusals it exists to produce.
 *
 * Every test here is a way the product could have lied to a user:
 *
 * - a group the model omitted must **fail**, not become its default;
 * - a well-formed but all-default answer must be **refused**, not persisted as
 *   something that looks learned;
 * - a description carrying a project name, a date, or a figure must be
 *   **refused**, because a style profile that reproduces the document's content
 *   is a copy of the document.
 */

import { describe, expect, it } from "vitest";

import {
  EMPTY_ANALYSIS_MESSAGE,
  extractionFreeText,
  parseSemanticStyleExtraction,
  SemanticStyleExtractionSchema,
} from "../../../../src/analysis/semantic/semanticStyleExtraction";
import {
  createEmptySemanticStyleProfile,
  isDefaultSemanticStyle,
} from "../../../../src/core/domain/SemanticStyleProfile";

/** A complete, schema-valid answer that says something. */
function extraction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tone: { primary: "analytical", secondary: ["restrained"], description: "" },
    voice: {
      person: "third",
      construction: "active",
      authorialPresence: "restrained",
      description: "",
    },
    formality: { score: 72, label: "professional" },
    register: { primary: "expert", description: "" },
    assertionStyle: { strength: "qualified", ordering: "evidence-first", directness: "measured" },
    qualificationStyle: {
      frequency: "frequent",
      strength: "moderate",
      exceptions: "inline",
      conditionals: true,
    },
    evidenceFraming: {
      recordFirst: true,
      attribution: "systematic",
      quotation: "frequent",
      explicitReferences: true,
      progression: "source-analysis-conclusion",
    },
    uncertaintyStyle: {
      incompleteEvidence: "stated",
      confidenceLanguage: "explicit",
      modality: "frequent",
      avoidsUnsupportedCertainty: true,
    },
    sentenceArchitecture: {
      complexity: "complex",
      clauseDensity: "high",
      targetWords: 28,
      coordination: "subordination",
      shortClosingSentence: true,
    },
    paragraphArchitecture: {
      function: "analysis",
      ordering: "topic-evidence-conclusion",
      targetWords: 140,
      propositions: "multiple",
    },
    transitions: "explicit",
    agency: { actorNaming: "named", passiveTendency: "low", attributionPrecision: "exact" },
    technicality: { density: "high", explainsTerms: false, abbreviationTendency: "first-use" },
    rhetoricalStyle: "forensic",
    conclusionStyle: { form: "qualified", avoidsRepetition: true },
    lexicalPreferences: {
      toneAvoid: ["utilise", "leverage"],
      prefersNeutralVerbs: true,
      evaluativeLanguage: "restrained",
    },
    ...overrides,
  };
}

const SAMPLE =
  "Activity ACT-0142 was programmed to complete on 30 June 2025. " +
  "The prolongation cost of £1,240,000, recorded against event EVT-0087, is recoverable in my opinion.";

describe("SemanticStyleExtractionSchema", () => {
  it("accepts a complete answer", () => {
    expect(SemanticStyleExtractionSchema.safeParse(extraction()).success).toBe(true);
  });

  it("refuses an answer that omits a group", () => {
    const partial = extraction();
    delete partial.tone;
    const result = SemanticStyleExtractionSchema.safeParse(partial);
    expect(result.success).toBe(false);
    // The failure names the group, so the message the user sees is specific.
    expect(JSON.stringify(result)).toContain("tone");
  });

  it("fills a leaf the model omits inside a group it did answer", () => {
    /*
     * The strictness is at group level, and deliberately so.
     *
     * "The model told us nothing about evidence framing" and "the model said the
     * attribution is occasional but not the rest" are different answers, and only
     * the first may be presented to the user as a failure. What must never happen
     * is the reverse — a whole group becoming its default because the response
     * was empty — and requiring every group is what prevents that.
     */
    const partial = extraction({ formality: { label: "professional" } });
    expect(SemanticStyleExtractionSchema.safeParse(partial).success).toBe(true);

    const outcome = parseSemanticStyleExtraction(partial, SAMPLE);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.formality.label).toBe("professional");
    expect(outcome.value.formality.score).toBe(50);
  });

  it("refuses an enum value it does not name", () => {
    const invented = extraction({ rhetoricalStyle: "withering" });
    expect(SemanticStyleExtractionSchema.safeParse(invented).success).toBe(false);
  });

  it("is not the persisted schema: the same empty object parses differently", () => {
    // The whole reason this schema exists. `SemanticStyleProfileSchema` accepts
    // `{}` because a stored record must tolerate absence; if this one did too,
    // "the model told us nothing" would persist as a confident default profile.
    expect(createEmptySemanticStyleProfile()).toBeTruthy();
    expect(SemanticStyleExtractionSchema.safeParse({}).success).toBe(false);
  });
});

describe("parseSemanticStyleExtraction", () => {
  it("produces a persisted profile the rules engine can read", () => {
    const outcome = parseSemanticStyleExtraction(extraction(), SAMPLE);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.schemaVersion).toBe(2);
    expect(outcome.value.tone.primary).toBe("analytical");
    expect(outcome.value.evidenceFraming.recordFirst).toBe(true);
    expect(isDefaultSemanticStyle(outcome.value)).toBe(false);
  });

  it("refuses an incomplete answer and names what is missing", () => {
    const partial = extraction();
    delete partial.evidenceFraming;
    const outcome = parseSemanticStyleExtraction(partial, SAMPLE);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal.reason).toBe("schema");
    expect(outcome.refusal.message).toContain("evidenceFraming");
  });

  it("refuses a valid but all-default answer as uninformative", () => {
    // Well-formed, every group present, and it says nothing at all.
    const blank = SemanticStyleExtractionSchema.parse(
      extraction({
        tone: { primary: "neutral", secondary: [], description: "" },
        voice: {
          person: "impersonal",
          construction: "balanced",
          authorialPresence: "restrained",
          description: "",
        },
        formality: { score: 50, label: "" },
        register: { primary: "professional", description: "" },
        assertionStyle: {
          strength: "qualified",
          ordering: "evidence-first",
          directness: "measured",
        },
        qualificationStyle: {
          frequency: "occasional",
          strength: "moderate",
          exceptions: "inline",
          conditionals: true,
        },
        evidenceFraming: {
          recordFirst: true,
          attribution: "occasional",
          quotation: "selective",
          explicitReferences: false,
          progression: "source-analysis-conclusion",
        },
        uncertaintyStyle: {
          incompleteEvidence: "stated",
          confidenceLanguage: "explicit",
          modality: "occasional",
          avoidsUnsupportedCertainty: true,
        },
        sentenceArchitecture: {
          complexity: "moderate",
          clauseDensity: "medium",
          targetWords: 22,
          coordination: "mixed",
          shortClosingSentence: false,
        },
        paragraphArchitecture: {
          function: "mixed",
          ordering: "topic-evidence-conclusion",
          targetWords: 90,
          propositions: "single",
        },
        transitions: "restrained",
        agency: { actorNaming: "named", passiveTendency: "low", attributionPrecision: "exact" },
        technicality: { density: "medium", explainsTerms: true, abbreviationTendency: "first-use" },
        rhetoricalStyle: "direct-analytical",
        conclusionStyle: { form: "qualified", avoidsRepetition: true },
        lexicalPreferences: {
          toneAvoid: [],
          prefersNeutralVerbs: true,
          evaluativeLanguage: "restrained",
        },
      }),
    );

    const outcome = parseSemanticStyleExtraction(blank, SAMPLE);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal.reason).toBe("emptyAnalysis");
    expect(outcome.refusal.message).toBe(EMPTY_ANALYSIS_MESSAGE);
  });

  it("refuses a description that names a party from the sample", () => {
    const leaked = extraction({
      tone: {
        primary: "analytical",
        secondary: ["restrained"],
        description: "in the manner of Ardmore Construction Group",
      },
    });
    const outcome = parseSemanticStyleExtraction(
      leaked,
      "The Contractor (Ardmore Construction Group) notified the Employer on 30 June 2025.",
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusal.reason).toBe("factualLeakage");
    if (outcome.refusal.reason !== "factualLeakage") return;
    expect(outcome.refusal.tokens).toContain("Ardmore Construction Group");
  });

  it("refuses a description that quotes a figure from the sample", () => {
    const leaked = extraction({
      register: { primary: "expert", description: "the figure used was £1,240,000" },
    });
    const outcome = parseSemanticStyleExtraction(leaked, SAMPLE);
    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.refusal.reason !== "factualLeakage")
      throw new Error("expected a leak");
    expect(outcome.refusal.tokens).toContain("£1,240,000");
  });

  it("refuses a description that quotes a date from the sample", () => {
    const leaked = extraction({
      voice: {
        person: "third",
        construction: "active",
        authorialPresence: "restrained",
        description: "dated 30 June 2025",
      },
    });
    const outcome = parseSemanticStyleExtraction(leaked, SAMPLE);
    expect(outcome.ok).toBe(false);
  });

  it("allows a description that shares no protected token with the sample", () => {
    // A description is how nuance survives a closed enum. Refusing every one of
    // them would make the field useless, and the check is about content, not
    // about the presence of free text.
    const safe = extraction({
      tone: {
        primary: "analytical",
        secondary: ["restrained"],
        description: "states the conclusion before defending it",
      },
    });
    expect(parseSemanticStyleExtraction(safe, SAMPLE).ok).toBe(true);
  });

  it("checks the leak surface, not the whole answer", () => {
    // The enum values necessarily repeat words that appear in the sample; only
    // the free text can leak, because only the free text can paraphrase.
    const parsed = SemanticStyleExtractionSchema.parse(extraction());
    expect(extractionFreeText(parsed)).toBe("utilise leverage");
  });
});
