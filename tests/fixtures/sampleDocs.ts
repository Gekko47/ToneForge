export const SAMPLE_PARAGRAPHS = [
  "The quick brown fox jumps over the lazy dog. This sentence has exactly twelve words.",
  "Second paragraph here. It introduces a new idea and ends with a question?",
];

export const SAMPLE_TEXT = SAMPLE_PARAGRAPHS.join("\n\n");

export const SAMPLE_PROFILE = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Sample",
  version: { major: 1, minor: 0, patch: 0 },
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
