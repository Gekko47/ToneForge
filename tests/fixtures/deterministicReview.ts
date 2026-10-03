/**
 * Golden fixtures for the deterministic review integration corpus.
 *
 * Spec §26 names eleven end-to-end cases. Each is stated here as the *input* a
 * test feeds in and the finding categories it must produce, rather than as a
 * frozen list of generated ids and message strings.
 *
 * **Why categories and not full findings.** Findings are minted with a fresh uuid
 * on every run, and their messages are prose that a copy-edit is entitled to
 * reword. A golden file that pinned either would fail on a change that altered
 * nothing about the behaviour, which teaches the suite to be re-baselined at
 * every wording change. The category, the range, the expected value and whether
 * a correction is offered are the parts that describe what ToneForge decided.
 *
 * **Why the corrections are asserted separately.** A finding and its correction
 * are two claims. "This is a deviation" and "ToneForge can safely fix this" have
 * different failure modes, and a test that only counts findings would pass while
 * the planner silently stopped offering a change for a category the user relies
 * on.
 */

import { v4 as uuidv4 } from "uuid";
import { StyleProfileSchema, type StyleProfile } from "../../src/core/domain/StyleProfile";
import type { FormattingSnapshot } from "../../src/formatting/formattingSnapshot";

/** What a test asserts about one case. */
export interface DeterministicFixture {
  /** Stable id used in test names, so a failure names the case. */
  readonly name: string;
  /** A short statement of what the case exists to prove. */
  readonly intent: string;
  /** Document text, as the Word boundary would have acquired it. */
  readonly text: string;
  /**
   * The profile under test. Defaults to {@link REVIEW_PROFILE}, which exercises
   * house terminology and the em-dash convention together.
   */
  readonly profile?: StyleProfile;
  /** Formatting DTO, for the cases that are about formatting. */
  readonly formatting?: FormattingSnapshot;
  /** Finding categories the review must report, at least once each. */
  readonly expectedCategories: readonly string[];
  /** Finding categories that must not appear, with the reason stated. */
  readonly absentCategories?: Readonly<Record<string, string>>;
  /** Categories whose findings must be correctable into a Change. */
  readonly correctableCategories?: readonly string[];
  /**
   * Categories the review may legitimately report as non-actionable.
   *
   * An empty array is a claim: it says every deviation this fixture produces can
   * be corrected. A case that expects a non-correctable finding must say so here
   * rather than letting the test discover it as an unexpected absence.
   */
  readonly nonCorrectableCategories?: readonly string[];
  /** Node ids the acquisition marked out of governance scope, if any. */
  readonly protectedText?: string;
}

/** Heading 1..9 style names, ordered, for cases that need a real hierarchy. */
const HEADING_STYLES: readonly string[] = Array.from(
  { length: 9 },
  (_unused, index) => `Heading ${index + 1}`,
);

/**
 * The profile the corpus is written against.
 *
 * Curly quotes, an em dash, `program` → `programme`, and a body standard of
 * Normal at 11pt with 6pt after — chosen so the text cases and the formatting
 * cases can share one profile rather than each declaring a near-copy.
 */
export const REVIEW_PROFILE: StyleProfile = StyleProfileSchema.parse({
  id: "44444444-4444-4444-8444-444444444444",
  name: "Review corpus",
  revision: 1,
  kind: "deterministic",
  measured: {},
  semantic: {},
  typography: {
    emDash: "em",
    emDashSpacing: "spaced",
    enDashSpacing: "spaced",
    doubleQuotes: "curly",
    singleQuotes: "curly",
    apostrophes: "curly",
    decimalSeparator: "dot",
    thousandsSeparator: "space",
    ellipsis: "ellipsis",
  },
  /*
   * The corpus term is `language.terminology`, not `houseStyle`.
   *
   * It used to be `houseStyle.preferredTerminology`, and the corpus still ran —
   * but for a reason that hid ND-13 completely. The `language/terminology` rule
   * reads `language.legacyPreferredTerminology` alongside `language.terminology`,
   * so a profile could satisfy the engine through the legacy map while the field
   * under test was the inert one. Nothing in the corpus could tell the difference
   * between a term that worked and a term that had quietly stopped working.
   *
   * The rule and the fixture now name the same field, which is what makes this
   * fixture an acceptance test again rather than a decoration.
   */
  language: {
    terminology: [
      {
        id: "term-1",
        source: "program",
        replacement: "programme",
        caseSensitive: false,
        wholeWord: true,
        severity: "advisory",
        scope: {},
      },
    ],
  },
  houseStyle: {
    capitalization: { sentenceCase: true, titleCaseWords: [] },
    spellingVariant: "en-GB",
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  sourceSampleIds: [],
});

/**
 * A formatting paragraph with every optional property left absent.
 *
 * Absent rather than `null` on purpose: acquisition reports a property it did
 * not read as absent or unsupported, and a fixture that fills every field in
 * cannot express "this host would not serve us the list level".
 */
export function reviewParagraph(
  index: number,
  text: string,
  overrides: Partial<FormattingSnapshot["paragraphs"][number]> = {},
): FormattingSnapshot["paragraphs"][number] {
  return {
    index,
    text,
    styleName: "Normal",
    alignment: null,
    lineSpacing: null,
    spaceAfter: null,
    spaceBefore: null,
    listLevel: null,
    fontName: null,
    fontSize: null,
    fontColor: null,
    bold: null,
    italic: null,
    underline: null,
    ...overrides,
  };
}

/** A formatting snapshot over the supplied paragraphs. */
export function reviewFormatting(
  paragraphs: readonly FormattingSnapshot["paragraphs"][number][],
): FormattingSnapshot {
  return {
    id: "review-corpus-snapshot",
    text: paragraphs.map((paragraph) => paragraph.text).join("\n\n"),
    fullText: paragraphs.map((paragraph) => paragraph.text).join("\n\n"),
    paragraphs: [...paragraphs],
    capturedAt: "2026-01-01T00:00:00.000Z",
    hash: "reviewcorpus",
  };
}

/**
 * The eleven cases from spec §26.
 *
 * Ordered as the specification lists them, so a reader can walk this file beside
 * §26 without reordering anything in their head.
 */
export const DETERMINISTIC_REVIEW_FIXTURES: readonly DeterministicFixture[] = [
  {
    name: "house terminology program to programme",
    intent:
      "A configured house substitution fires once per occurrence, reports the configured replacement, and is correctable.",
    text: "The recovery program was late. The program review found the cause.",
    profile: REVIEW_PROFILE,
    expectedCategories: ["houseStyle.terminology"],
    correctableCategories: ["houseStyle.terminology"],
  },
  {
    name: "em dash convention",
    intent:
      "A double hyphen is reported against the configured em-dash representation and is correctable to the em dash character.",
    text: "The report--as expected--was late.",
    profile: REVIEW_PROFILE,
    expectedCategories: ["typography.emDash"],
    correctableCategories: ["typography.emDash"],
  },
  {
    name: "heading 2 style",
    intent:
      "A body paragraph carrying heading text is compared against the profile's heading standard, and the correction is a style application rather than a formatting write.",
    text: "Section 4.3 Recovery details",
    profile: REVIEW_PROFILE,
    formatting: reviewFormatting([
      reviewParagraph(0, "Section 4.3 Recovery details", { styleName: "Normal" }),
    ]),
    expectedCategories: ["formatting.bodyStyle"],
    correctableCategories: ["formatting.bodyStyle"],
  },
  {
    name: "body paragraph spacing",
    intent:
      "A body paragraph whose spacing differs from the profile standard is reported, and the correction sets paragraph format rather than clearing character formatting.",
    text: "A body paragraph with no configured spacing.",
    profile: REVIEW_PROFILE,
    formatting: reviewFormatting([
      reviewParagraph(0, "A body paragraph with no configured spacing.", {
        styleName: "Normal",
        spaceAfter: 0,
      }),
    ]),
    expectedCategories: ["formatting.paragraphFormat"],
    correctableCategories: ["formatting.paragraphFormat"],
  },
  {
    name: "list level mismatch",
    intent:
      "A list item whose level contradicts its style is reported against the profile's list standard, and the correction is the configured level rather than a reset to zero.",
    text: "A list item sitting at the wrong level.",
    profile: REVIEW_PROFILE,
    formatting: reviewFormatting([
      reviewParagraph(0, "A list item sitting at the wrong level.", {
        styleName: "List Paragraph",
        listLevel: 3,
      }),
    ]),
    expectedCategories: ["formatting.listLevel"],
    correctableCategories: ["formatting.listLevel"],
  },
  {
    name: "mixed direct formatting",
    intent:
      "Direct formatting is reported, and a run of legitimate emphasis is not cleared: the finding is present and carries no reset correction.",
    text: "A paragraph where the author emphasised part of it.",
    profile: REVIEW_PROFILE,
    formatting: reviewFormatting([
      reviewParagraph(0, "A paragraph where the author emphasised part of it.", {
        styleName: "Normal",
        fontSize: 14,
        bold: true,
        italic: null,
        provenance: {
          alignment: "unknown",
          lineSpacing: "unknown",
          spaceAfter: "unknown",
          spaceBefore: "unknown",
          listLevel: "unknown",
          fontName: "style",
          fontSize: "direct",
          fontColor: "unknown",
          bold: "direct",
          italic: "unknown",
          underline: "unknown",
        },
      }),
    ]),
    expectedCategories: ["formatting.directFormatting"],
    // The whole point of this case: the deviation is real, and the safe
    // correction is not available. `resetCharacterFormatting` here would erase
    // the author's emphasis along with the accidental override.
    correctableCategories: [],
    nonCorrectableCategories: ["formatting.directFormatting"],
  },
  {
    name: "protected quotation",
    intent:
      "Text inside quotation marks is excluded by the protection policy: a deviation inside it is neither reported nor corrected.",
    text: 'The style guide says "the recovery program was late" and the report agrees.',
    profile: REVIEW_PROFILE,
    expectedCategories: [],
    absentCategories: {
      "houseStyle.terminology":
        "The only occurrence of the configured term is inside a protected quoted span, so reporting it would offer to rewrite a quotation.",
    },
    protectedText: "the recovery program was late",
  },
  {
    name: "table formatting",
    intent:
      "A table's supported properties are compared against the profile, and anything the host cannot verify is reported as a coverage limitation rather than as compliance.",
    text: "A document containing a table.",
    profile: REVIEW_PROFILE,
    expectedCategories: [],
    absentCategories: {
      "formatting.tableStyle":
        "No table was acquired, so there is nothing to compare. This case exists so a test can assert the coverage statement instead.",
    },
  },
  {
    name: "unsupported scope",
    intent:
      "When a requested scope could not be examined, the report says so and no whole-document verdict is issued.",
    text: "A plain document with nothing out of the ordinary.",
    profile: REVIEW_PROFILE,
    expectedCategories: [],
    /*
     * The expectation here is negative, and that is the point of the case. A
     * scope the host could not examine must not produce a finding, and must not
     * be silently folded into a clean verdict either — the run is incomplete and
     * the coverage block says which scope is missing.
     */
    absentCategories: {
      "formatting.tableStyle":
        "The tables scope was requested but the host could not read it. Silence here is not compliance; the coverage block carries the shortfall instead.",
    },
  },
  {
    name: "profile revision between scan and apply",
    intent:
      "A review built under one profile revision cannot be carried into a plan built under another; the session fingerprint changes and the approvals are invalidated.",
    text: "The recovery program was late.",
    profile: REVIEW_PROFILE,
    expectedCategories: ["houseStyle.terminology"],
  },
  {
    name: "document edit between preview and apply",
    intent:
      "A plan is refused when the document changed after the preview, whatever the user's approvals said.",
    text: "The recovery program was late.",
    profile: REVIEW_PROFILE,
    expectedCategories: ["houseStyle.terminology"],
    correctableCategories: ["houseStyle.terminology"],
  },
];

/** Look one fixture up by name, failing loudly rather than returning undefined. */
export function fixtureNamed(name: string): DeterministicFixture {
  const found = DETERMINISTIC_REVIEW_FIXTURES.find((fixture) => fixture.name === name);
  if (found === undefined) {
    throw new Error(
      `No deterministic review fixture named "${name}". Known: ${DETERMINISTIC_REVIEW_FIXTURES.map((fixture) => fixture.name).join(", ")}`,
    );
  }
  return found;
}

/** A fresh uuid, so a test building findings does not collide with the fixtures. */
export function freshId(): string {
  return uuidv4();
}

/** The heading style names, exported for tests that build a real hierarchy. */
export { HEADING_STYLES };
