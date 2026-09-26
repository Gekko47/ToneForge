import { FindingSchema, type Finding } from "../../src/core/domain/Finding";

/**
 * Build a valid `Finding` for a component or integration test.
 *
 * Tests that render finding cards need a schema-valid finding, and hand-writing
 * one in every file is how a test ends up asserting against a shape the domain
 * no longer accepts. Defaults cover the fields a card displays.
 */
export function sampleFinding(overrides: Partial<Finding> = {}): Finding {
  return FindingSchema.parse({
    id: "22222222-2222-2222-2222-222222222222",
    kind: "deterministic",
    category: "typography.emDash",
    message: "An em dash is used where the profile calls for a spaced en dash.",
    status: "new",
    severity: "warning",
    range: { start: 0, end: 12, unit: "character" },
    nodeIds: ["33333333-3333-3333-3333-333333333333"],
    source: "deterministic",
    ...overrides,
  });
}

export const SAMPLE_PARAGRAPHS = [
  "The quick brown fox jumps over the lazy dog. This sentence has exactly twelve words.",
  "Second paragraph here. It introduces a new idea and ends with a question?",
];

export const SAMPLE_TEXT = SAMPLE_PARAGRAPHS.join("\n\n");

export const SAMPLE_PROFILE = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Sample",
  revision: 1,
  measured: {
    avgSentenceLength: 12,
    sentenceLengthStdDev: 2,
    emDashFrequency: 0,
    enDashFrequency: 0,
    curlyQuoteFrequency: 0,
    paragraphLengthAvg: 12,
    capitalizationConsistency: 1,
    sampleWordCount: 24,
  },
  semantic: {
    tone: "neutral",
    voice: "third-person",
    formality: 50,
    readingGradeTarget: null,
    preferredSentenceLength: 12,
    vocabularyRegister: "standard",
    rhetoricalStyle: "direct",
    avoidWords: [],
  },
  typography: {
    emDash: "em",
    enDashSpacing: "spaced",
    doubleQuotes: "curly",
    singleQuotes: "curly",
    apostrophes: "curly",
    decimalSeparator: "dot",
    thousandsSeparator: "none",
    ellipsis: "ellipsis",
  },
  houseStyle: {
    preferredTerminology: {},
    bannedTerms: [],
    capitalization: { sentenceCase: true, titleCaseWords: [] },
    spellingVariant: "en-US",
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  sourceSampleIds: [],
};
