import { FindingSchema, type Finding } from "../../src/core/domain/Finding";
import { DocumentNodeSchema } from "../../src/core/domain/DocumentSnapshot";
import { TypographyRulesSchema } from "../../src/core/domain/StyleProfile";
import { createEmptySemanticStyleProfile } from "../../src/core/domain/SemanticStyleProfile";

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

/**
 * Build a schema-valid in-scope `DocumentNode` for coverage and analysis tests.
 *
 * Parsed through the real schema on purpose: a hand-rolled node that omits
 * `sourcePath` or `includedInGovernance` produces a coverage report that fails
 * validation, which reads as a bug in the code under test rather than in the
 * fixture.
 */
export function sampleNode(
  type: "paragraph" | "body" = "paragraph",
  text = "sample text",
  includedInGovernance = true,
): ReturnType<typeof DocumentNodeSchema.parse> {
  return DocumentNodeSchema.parse({
    nodeId: "55555555-5555-5555-5555-555555555555",
    type,
    text,
    sourcePath: `body/${type}s/0`,
    editable: true,
    includedInGovernance,
    includedInAIReview: includedInGovernance,
    ...(includedInGovernance ? {} : { protectionReason: "Protected text" }),
  });
}

export const SAMPLE_PARAGRAPHS = [
  "The quick brown fox jumps over the lazy dog. This sentence has exactly twelve words.",
  "Second paragraph here. It introduces a new idea and ends with a question?",
];

export const SAMPLE_TEXT = SAMPLE_PARAGRAPHS.join("\n\n");

/**
 * A full, valid typography rules object.
 *
 * Tests that need one field set almost always need the rest at their defaults,
 * and spelling out nineteen fields to change one is how a new field ends up
 * absent from the test that would have covered it. Parsing the partial input
 * makes the schema the single source of truth for the defaults.
 */
export function sampleTypography(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof TypographyRulesSchema.parse> {
  return TypographyRulesSchema.parse(overrides);
}

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
    ...createEmptySemanticStyleProfile(),
    tone: { primary: "neutral", secondary: [], description: "" },
    formality: { score: 50, label: "" },
    sentenceArchitecture: {
      complexity: "moderate",
      clauseDensity: "medium",
      targetWords: 12,
      coordination: "mixed",
      shortClosingSentence: false,
    },
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
    // `sentenceCase` was removed with its rule and toggle (ADR-0125). Zod strips
    // the unknown key, so leaving it here would have been harmless and misleading:
    // a fixture that names a field the product does not have is a fixture that
    // reads as if it does.
    capitalization: { titleCaseWords: [] },
    spellingVariant: "en-US",
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  sourceSampleIds: [],
};
