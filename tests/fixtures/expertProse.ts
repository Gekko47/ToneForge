/**
 * Synthetic construction and quantum expert prose for Semantic Review tests.
 *
 * **Every project, party, figure, and date in this file is invented.** There is no
 * real engagement, client, or expert here, and none of it may be replaced with
 * real material: the corpus exists so the preservation validator and the review
 * prompt can be tested against the *shape* of expert-report writing without
 * putting anyone's document into a repository.
 *
 * It is a fixture, not a test file, so Vitest does not collect it and it is not
 * part of the coverage measurement. It is the single source of representative
 * writing for:
 *
 * - P2 — the V2 style-learning prompt, which must extract style from these
 *   samples and must not copy their facts into a profile.
 * - P3 — the local preservation validator, via the paired
 *   `PROTECTED_FACT_PRESERVATION_CASES` below, where each case changes exactly
 *   one protected token class and leaves every other byte identical.
 * - P4 — the review engine, via `MEANING_PRESERVATION_CASES`, where meaning
 *   changes through wording alone and no token moves.
 * - P5 — the selection-scope reader, which needs a paragraph with a known
 *   absolute start offset.
 * - P7 — the comparison view, which needs an original and a faithful restyle of
 *   the same paragraph.
 *
 * Two rules govern every case here.
 *
 * 1. **One change per case.** A preservation case that alters a date *and* a
 *    figure proves nothing about which check fired, and a validator that
 *    reports both would pass it. Each variant below is the base paragraph with
 *    exactly one span replaced.
 * 2. **Every expected outcome is declared, not implied.** `expected` is the
 *    verdict the product owes the user, written down here so the validator is
 *    tested against a stated contract rather than against its own output.
 *
 * The tier vocabulary is the one approved in the plan's D6: `hard` disables
 * Apply, `soft` requires an explicit acknowledgement, `clean` needs neither.
 */

/** Join sentences into one paragraph, keeping every source line under 100 columns. */
function para(...sentences: string[]): string {
  return sentences.join(" ");
}

/** The styles of assertion a construction expert actually writes in. */
export const EXPERT_ASSERTION_SAMPLES: ReadonlyArray<{
  readonly id: string;
  readonly text: string;
}> = [
  {
    id: "assertion-categorical",
    text: para(
      "Activity ACT-0142 did not complete on 30 June 2025.",
      "The Employer is liable for the resulting prolongation cost.",
    ),
  },
  {
    id: "assertion-qualified",
    text: para(
      "Activity ACT-0142 did not complete on 30 June 2025.",
      "The Employer is, in my opinion, likely to be liable for the resulting prolongation cost, subject to clause 12.4.3.",
    ),
  },
  {
    id: "assertion-conditional",
    text: para(
      "If the design information had been issued on 12 May 2025, Activity ACT-0142 would have completed on time.",
      "On that footing the Employer is not liable for prolongation.",
    ),
  },
  {
    id: "assertion-provisional",
    text: para(
      "On the information presently available, and provisionally, the prolongation cost appears to be £1,240,000.",
      "That figure will be confirmed once event EVT-0087 is closed.",
    ),
  },
];

/** Who the assertion belongs to, and how the reader is told. */
export const EXPERT_ATTRIBUTION_SAMPLES: ReadonlyArray<{
  readonly id: string;
  readonly text: string;
}> = [
  {
    id: "attribution-expert",
    text: para(
      "In my opinion, the delay to Activity ACT-0142 was caused by late design information.",
    ),
  },
  {
    id: "attribution-contractor",
    text: para(
      "The Contractor (Ardmore Construction Group) contends that the delay to Activity ACT-0142 was caused by late design information.",
    ),
  },
  {
    id: "attribution-employer",
    text: para(
      "The Employer (Meridian Civil Works Ltd) maintains that the Contractor (Ardmore Construction Group) delayed Activity ACT-0142 by failing to resource the activity as programme required.",
    ),
  },
  {
    id: "attribution-quoted-record",
    text: para(
      "The contemporaneous site record states, in terms, that",
      '"resourcing of ACT-0142 was reduced to two gangs from 4 June 2025 at the Employer\'s direction".',
    ),
  },
];

/** The four delay questions a programme expert is asked. */
export const EXPERT_DELAY_SAMPLES: ReadonlyArray<{ readonly id: string; readonly text: string }> = [
  {
    id: "delay-programme",
    text: para(
      "The programme of works shows Activity ACT-0142 finishing on 30 June 2025.",
      "It finished on 11 August 2025, a slip of 42 days against the baseline.",
    ),
  },
  {
    id: "delay-critical-path",
    text: para(
      "In my opinion ACT-0142 was on the critical path throughout the period under review,",
      "and its 42-day slip moved the completion date by 42 days rather than by float.",
    ),
  },
  {
    id: "delay-concurrency",
    text: para(
      "The Employer contends the Contractor was in culpable delay on the same activity at the same time.",
      "Subject to the concurrency question raised at paragraph 4.2, I am not presently able to determine which party caused which part of the 42 days.",
    ),
  },
  {
    id: "delay-forecast-actual",
    text: para(
      "The Contractor's forecast of 11 August 2025 has been overtaken by events;",
      "the actual finish was 29 August 2025, and the further 18 days are attributable to the late issue of design information.",
    ),
  },
];

/** The four quantum questions a quantity surveyor is asked. */
export const EXPERT_QUANTUM_SAMPLES: ReadonlyArray<{ readonly id: string; readonly text: string }> =
  [
    {
      id: "quantum-valuation",
      text: para(
        "In my opinion the reasonable valuation of the Works executed to 30 June 2025 is £1,240,000,",
        "as recorded against event EVT-0087.",
      ),
    },
    {
      id: "quantum-basis",
      text: para(
        "That valuation is stated on a substantially complete basis.",
        "It excludes variations instructed after 1 July 2025, which have not yet been measured.",
      ),
    },
    {
      id: "quantum-calculation",
      text: para(
        "The sum is calculated as 320 hours at £38.50 per hour, being £12,320.00,",
        "plus materials of £1,227,680, giving £1,240,000 in total.",
      ),
    },
    {
      id: "quantum-provisional",
      text: para(
        "A provisional sum of £180,000 remains within the certified interim valuation.",
        "It has not been spent and should not be treated as a recoverable cost.",
      ),
    },
  ];

/** How the author introduces the evidence, which is what the assessment reports on. */
export const EXPERT_EVIDENCE_FRAMING_SAMPLES: ReadonlyArray<{
  readonly id: string;
  readonly text: string;
}> = [
  {
    id: "evidence-source-first",
    text: para(
      "The contemporaneous site record for June 2025 shows two gangs on ACT-0142 from 4 June 2025.",
      "The activity finished 42 days late. In my opinion the delay was caused by late design information.",
    ),
  },
  {
    id: "evidence-conclusion-first",
    text: para(
      "The delay to ACT-0142 was caused by late design information.",
      "That conclusion rests on the contemporaneous site record, which shows two gangs on the activity from 4 June 2025.",
    ),
  },
  {
    id: "evidence-chronological",
    text: para(
      "Design information was due on 12 May 2025 and was issued on 3 July 2025.",
      "Resourcing on ACT-0142 was reduced on 4 June 2025.",
      "The activity completed on 11 August 2025 rather than 30 June 2025.",
    ),
  },
  {
    id: "evidence-comparative",
    text: para(
      "By contrast, Activity ACT-0155, which was not affected by the design delay, finished within 2 days of its baseline date.",
    ),
  },
];

/**
 * One long, internally consistent sample for the V2 style-learning prompt.
 *
 * Deliberately written the way a construction expert writes: the record first,
 * the analysis second, the opinion last and qualified, actors named, figures
 * carried, causation stated in one direction. Roughly 350 words, which is the
 * `good` band the plan's quality ladder defines, so the same sample can be used
 * to test the level thresholds without a second fixture.
 *
 * The test that uses it asserts the model returns **style** and not **content**:
 * a response that carries `Halvorsen Quay` or `£1,240,000` into the profile is
 * a failing response, and the fixture makes that checkable.
 */
export const EXPERT_LEARNING_SAMPLE = para(
  "The contemporaneous site record for June 2025 shows that resourcing of Activity ACT-0142 was",
  "reduced to two gangs from 4 June 2025. That reduction is recorded in the daily reports and was",
  "notified to the Employer (Meridian Civil Works Ltd) under clause 12.4.3 on 9 June 2025.",
  "",
  "The programme of works programmed ACT-0142 for completion on 30 June 2025.",
  "The activity completed on 11 August 2025, a slip of 42 days against the baseline.",
  "In my opinion the activity was on the critical path throughout the period under review, and the",
  "slip therefore moved the contractual completion date by the same 42 days rather than being",
  "absorbed by float. That conclusion rests on the programme analysis at Appendix C and on the",
  "absence of any contemporaneous record of acceleration.",
  "",
  "The Contractor (Ardmore Construction Group) contends that the delay was caused by the late",
  "issue of design information, which was due on 12 May 2025 and issued on 3 July 2025.",
  "The Employer maintains that the Contractor failed to resource the activity as programme required.",
  "Subject to the concurrency question raised at paragraph 4.2, I am not presently able to",
  "determine which party caused which part of the 42 days, and I would not offer an opinion on",
  "causation until the daily reports for 4 June 2025 have been produced in full.",
  "",
  "The prolongation cost attributable to the period under review is, in my opinion, £1,240,000,",
  "recorded against event EVT-0087. That sum represents 4.2 % of the certified interim valuation and",
  "is stated on a substantially complete basis. It excludes variations instructed after 1 July 2025,",
  "which have not yet been measured, and it should not be treated as a final figure.",
);

/**
 * The base paragraph every protected-fact case is derived from.
 *
 * It carries one token of every deterministic class, so a variant that replaces a
 * single span is a clean single-variable experiment. Exported because the
 * selection-scope test needs the same text with a known offset.
 */
export const PRESERVATION_BASE_PARAGRAPH = para(
  "Activity ACT-0142 was programmed to complete on 30 June 2025.",
  "The contemporaneous site record shows the activity finished 42 days late,",
  "and the Contractor (Ardmore Construction Group) notified the Employer (Meridian Civil Works Ltd)",
  "under clause 12.4.3 that the delay was caused by late design information.",
  "The prolongation cost of £1,240,000, recorded against event EVT-0087, is recoverable in my opinion.",
  "That figure represents 4.2 % of the certified interim valuation.",
);

/** The protected token classes a validator must recognise. */
export type ProtectedTokenClass =
  | "date"
  | "duration"
  | "percentage"
  | "currency"
  | "activityIdentifier"
  | "eventIdentifier"
  | "partyName"
  | "clauseReference"
  | "negation"
  | "qualifier";

/** What the product owes the user for one case. */
export interface PreservationExpectation {
  /**
   * `hard` disables Apply, `soft` requires an explicit acknowledgement,
   * `clean` requires neither. The vocabulary is the plan's approved D6 split.
   */
  readonly tier: "hard" | "soft" | "clean";
  /** The token class the report is expected to name, when it names one. */
  readonly kind?: ProtectedTokenClass;
  /** The normalised value expected to be reported missing, changed, or added. */
  readonly value?: string;
  /** The replacement value, for a `changed` verdict. */
  readonly replacement?: string;
  /** Why this case exists, in one sentence, for whoever reads a failure. */
  readonly note: string;
}

export interface PreservationCase {
  readonly id: string;
  /** The single class this case is built to exercise. */
  readonly protectedClass: ProtectedTokenClass;
  readonly original: string;
  readonly proposed: string;
  readonly expected: PreservationExpectation;
}

/**
 * Cases where a protected token moves. All hard failures, all single-variable.
 *
 * Each proposed text is `PRESERVATION_BASE_PARAGRAPH` with exactly one span
 * replaced, so a validator that reports two changes is failing the fixture's
 * own premise and the test says so.
 */
export const PROTECTED_FACT_PRESERVATION_CASES: readonly PreservationCase[] = [
  {
    id: "date-moved",
    protectedClass: "date",
    original: PRESERVATION_BASE_PARAGRAPH,
    proposed: PRESERVATION_BASE_PARAGRAPH.replace("30 June 2025", "18 July 2025"),
    expected: {
      tier: "hard",
      kind: "date",
      value: "30 June 2025",
      replacement: "18 July 2025",
      note: "A restyle must never move a date. This is the single most damaging edit the product can make and the one an expert reader is guaranteed to notice.",
    },
  },
  {
    id: "duration-changed",
    protectedClass: "duration",
    original: PRESERVATION_BASE_PARAGRAPH,
    proposed: PRESERVATION_BASE_PARAGRAPH.replace("42 days", "24 days"),
    expected: {
      tier: "hard",
      kind: "duration",
      value: "42 days",
      replacement: "24 days",
      note: "A delay figure is a quantity, so a duration change is a factual change even when the surrounding sentence reads more smoothly.",
    },
  },
  {
    id: "percentage-changed",
    protectedClass: "percentage",
    original: PRESERVATION_BASE_PARAGRAPH,
    proposed: PRESERVATION_BASE_PARAGRAPH.replace("4.2 %", "6.8 %"),
    expected: {
      tier: "hard",
      kind: "percentage",
      value: "4.2 %",
      replacement: "6.8 %",
      note: "A percentage is a derived figure the author computed; changing it changes the argument, not the wording.",
    },
  },
  {
    id: "currency-changed",
    protectedClass: "currency",
    original: PRESERVATION_BASE_PARAGRAPH,
    proposed: PRESERVATION_BASE_PARAGRAPH.replace("£1,240,000", "£1,940,000"),
    expected: {
      tier: "hard",
      kind: "currency",
      value: "£1,240,000",
      replacement: "£1,940,000",
      note: "The headline valuation. A style rewrite that alters it is a content edit wearing a style edit's clothes.",
    },
  },
  {
    id: "activity-identifier-swapped",
    protectedClass: "activityIdentifier",
    original: PRESERVATION_BASE_PARAGRAPH,
    proposed: PRESERVATION_BASE_PARAGRAPH.replace("ACT-0142", "ACT-0197"),
    expected: {
      tier: "hard",
      kind: "activityIdentifier",
      value: "ACT-0142",
      replacement: "ACT-0197",
      note: "Two activities in the same programme differ by three digits. Substituting one for another produces a fluent, entirely false sentence.",
    },
  },
  {
    id: "event-identifier-swapped",
    protectedClass: "eventIdentifier",
    original: PRESERVATION_BASE_PARAGRAPH,
    proposed: PRESERVATION_BASE_PARAGRAPH.replace("EVT-0087", "EVT-0091"),
    expected: {
      tier: "hard",
      kind: "eventIdentifier",
      value: "EVT-0087",
      replacement: "EVT-0091",
      note: "An event reference is the join key between a narrative and a cost record. Moving it reattributes the sum.",
    },
  },
  {
    id: "party-renamed",
    protectedClass: "partyName",
    original: PRESERVATION_BASE_PARAGRAPH,
    proposed: PRESERVATION_BASE_PARAGRAPH.replace(
      "Ardmore Construction Group",
      "Ardmore Construction Holdings",
    ),
    expected: {
      tier: "hard",
      kind: "partyName",
      value: "Ardmore Construction Group",
      replacement: "Ardmore Construction Holdings",
      note: "A party name is attribution. Substituting a similar name preserves the sentence's grammar and reverses its responsibility.",
    },
  },
  {
    id: "clause-reference-changed",
    protectedClass: "clauseReference",
    original: PRESERVATION_BASE_PARAGRAPH,
    proposed: PRESERVATION_BASE_PARAGRAPH.replace("clause 12.4.3", "clause 12.4.8"),
    expected: {
      tier: "hard",
      kind: "clauseReference",
      value: "clause 12.4.3",
      replacement: "clause 12.4.8",
      note: "A clause reference is a legal citation. The validator must catch a single-digit change in the last group.",
    },
  },
  {
    id: "figure-removed",
    protectedClass: "currency",
    original: PRESERVATION_BASE_PARAGRAPH,
    proposed: PRESERVATION_BASE_PARAGRAPH.replace("The prolongation cost of £1,240,000, ", ""),
    expected: {
      tier: "hard",
      kind: "currency",
      value: "£1,240,000",
      note: "Dropping a figure is as much a change as altering it, and it is what a summarising rewrite does most often.",
    },
  },
];

/**
 * Cases where a qualifier or a negation moves. All soft warnings, per the
 * approved D6 split.
 *
 * These are the changes that decide whether an expert opinion still sounds like
 * an expert opinion. A hard block on this list would fire on most real sentences,
 * so each one asks for an acknowledgement rather than refusing the revision.
 */
export const QUALIFIER_PRESERVATION_CASES: readonly PreservationCase[] = [
  {
    id: "hedge-added",
    protectedClass: "qualifier",
    original: PRESERVATION_BASE_PARAGRAPH,
    proposed: PRESERVATION_BASE_PARAGRAPH.replace(
      "is recoverable in my opinion",
      "may be recoverable",
    ),
    expected: {
      tier: "soft",
      kind: "qualifier",
      value: "in my opinion",
      note: "Swapping an expert's own attribution for a modal weakens the register the profile is supposed to match. Legitimate as a style change, so it asks rather than refuses.",
    },
  },
  {
    id: "hedge-removed",
    protectedClass: "qualifier",
    original: PRESERVATION_BASE_PARAGRAPH,
    proposed: PRESERVATION_BASE_PARAGRAPH.replace(
      " is recoverable in my opinion.",
      " is recoverable.",
    ),
    expected: {
      tier: "soft",
      kind: "qualifier",
      value: "in my opinion",
      note: "Removing the reservation of opinion is the most common way a style rewrite turns a considered finding into an assertion.",
    },
  },
  {
    id: "negation-inserted",
    protectedClass: "negation",
    original: PRESERVATION_BASE_PARAGRAPH,
    proposed: PRESERVATION_BASE_PARAGRAPH.replace(
      "is recoverable in my opinion",
      "is not recoverable in my opinion",
    ),
    expected: {
      tier: "soft",
      kind: "negation",
      value: "not",
      note: "A single inserted negation reverses the conclusion while leaving every figure intact. This is the case that proves token preservation alone is not enough.",
    },
  },
];

/**
 * Cases where meaning changes through wording and no protected token moves.
 *
 * There is nothing deterministic to catch here, which is exactly why the review
 * model is asked for a structured `MeaningPreservationAssessment` and why the
 * plan's D6 treats its answer as evidence rather than proof. The engine test
 * scripts a model that returns `false` for the relevant flag and asserts the
 * product reports the model's own sentence as a soft warning.
 */
export const MEANING_PRESERVATION_CASES: ReadonlyArray<{
  readonly id: string;
  /** The flag the model is expected to return `false` for. */
  readonly flag:
    | "qualificationPreserved"
    | "attributionPreserved"
    | "causationPreserved"
    | "responsibilityPreserved"
    | "certaintyPreserved";
  readonly original: string;
  readonly proposed: string;
  readonly note: string;
}> = [
  {
    id: "causation-reversed",
    flag: "causationPreserved",
    original: para(
      "The Contractor (Ardmore Construction Group) notified the Employer (Meridian Civil Works Ltd)",
      "under clause 12.4.3 that the delay was caused by late design information.",
    ),
    proposed: para(
      "The Contractor (Ardmore Construction Group) notified the Employer (Meridian Civil Works Ltd)",
      "under clause 12.4.3 that the delay was caused by late resourcing on site.",
    ),
    note: "Same actors, same clause, same sentence length. The causal claim has been reassigned and no token check can see it.",
  },
  {
    id: "responsibility-reassigned",
    flag: "responsibilityPreserved",
    original: para(
      "The prolongation cost of £1,240,000, recorded against event EVT-0087, is recoverable in my opinion.",
    ),
    proposed: para(
      "The prolongation cost of £1,240,000, recorded against event EVT-0087, was incurred by the Contractor (Ardmore Construction Group) in my opinion.",
    ),
    note: "The sum and the event are untouched. Who bears it is the whole point of the paragraph.",
  },
  {
    id: "certainty-escalated",
    flag: "certaintyPreserved",
    original: para("It is unlikely that the delay was caused by late design information."),
    proposed: para("The delay was caused by late design information."),
    note: "An expert's probability has been promoted to a statement of fact with the word 'unlikely' deleted. No protected token moved, so every deterministic check passes this pair.",
  },
  {
    id: "attribution-detached",
    flag: "attributionPreserved",
    original: para("In my opinion, the delay was caused by late design information."),
    proposed: para("The delay was caused by late design information."),
    note: "Deleting the expert's own voice from an expert's own opinion. The sentence is grammatical, shorter, and no longer says whose view it is.",
  },
];

/**
 * A faithful restyle: same meaning, no protected token moved, no negation or
 * hedge moved.
 *
 * The clauses are reordered and the voice is made slightly more active, which is
 * exactly the kind of edit the product exists to propose. It must come back
 * `clean`, and it is the control for every case above — a validator that reports
 * this one as anything but clean is over-reporting and will train users to
 * disregard it.
 */
export const CLEAN_RESTYLE_CASE: PreservationCase = {
  id: "faithful-restyle",
  protectedClass: "qualifier",
  original: PRESERVATION_BASE_PARAGRAPH,
  proposed: para(
    "The activity finished 42 days late, and the contemporaneous site record shows that as a matter of record.",
    "The programme of works programmed ACT-0142 for completion on 30 June 2025.",
    "Under clause 12.4.3, the Contractor (Ardmore Construction Group) notified the Employer (Meridian Civil Works Ltd) that late design information had caused the delay.",
    "The prolongation cost of £1,240,000, recorded against event EVT-0087, is recoverable in my opinion.",
    "That figure represents 4.2 % of the certified interim valuation.",
  ),
  expected: {
    tier: "clean",
    note: "Reordered, revoiced, nothing protected moved. A validator that objects here is refusing the product's actual purpose.",
  },
};

/** Every case a preservation test should run, hard and soft together. */
export const ALL_PRESERVATION_CASES: readonly PreservationCase[] = [
  ...PROTECTED_FACT_PRESERVATION_CASES,
  ...QUALIFIER_PRESERVATION_CASES,
  CLEAN_RESTYLE_CASE,
];
