/**
 * Expert-labelled benchmark corpus (R7, original §38–§39).
 *
 * Each fixture is one comparison an expert has labelled: the E-questions the
 * deterministic resolver proved, the E-answers an expert gives to the
 * questions left unresolved, and the D-outcome and presentation the expert
 * expects. The benchmark runs identical DecisionPlans through candidate
 * decision models and measures whether their answers reproduce the expert's
 * derived outcome.
 *
 * The corpus covers attribution, scenarios, delay, quantum, definitions,
 * references and scope, including legitimate updates and basis changes beside
 * true contradictions — the false positives the 16-outcome derivation exists
 * to prevent.
 */

import type { ConsistencyCheckId, DOutcome } from "../contracts";

/** One E-answer in the corpus. */
export interface CorpusEAnswer {
  readonly question: string;
  readonly holds: boolean;
  readonly reason: string;
}

/** One expert-labelled comparison. */
export interface CorpusFixture {
  readonly id: string;
  readonly checkId: ConsistencyCheckId;
  /** The E-questions the deterministic resolver proved. */
  readonly deterministicAnswers: readonly CorpusEAnswer[];
  /** The expert's answers to the questions left unresolved. */
  readonly expertAnswers: readonly CorpusEAnswer[];
  /** The D-outcome the expert expects ToneForge to derive. */
  readonly expectedDOutcome: DOutcome;
  /** Whether the expert expects this to be presented as an issue. */
  readonly expectedPresent: boolean;
}

function a(question: string, holds: boolean, reason: string): CorpusEAnswer {
  return { question, holds, reason };
}

/**
 * The deterministic answers a fully comparable pair produces.
 *
 * Every facet the resolver can prove is answered, so the E-vector is
 * well-defined and the only open question is the one the fixture labels.
 */
const COMPARABLE: readonly CorpusEAnswer[] = [
  a("E-ENTITY-SAME", true, "same entity"),
  a("E-EVENT-SAME", true, "same event"),
  a("E-PREDICATE-COMPARABLE", true, "comparable predicate"),
  a("E-SCOPE-SAME", true, "same scope"),
  a("E-SCOPE-EXCEPTION", true, "no scope exception"),
  a("E-SCENARIO-SAME", true, "same scenario"),
  a("E-ATTRIBUTION-COMPATIBLE", true, "compatible attribution"),
  a("E-TEMPORAL-COMPARABLE", true, "comparable dates"),
  a("E-BASIS-SAME", true, "same basis"),
  a("E-PROGRAMME-BASIS-SAME", true, "same programme basis"),
  a("E-QUALIFIER-RECONCILES", true, "qualifiers reconcile"),
  a("E-CURRENCY-COMPATIBLE", true, "compatible units"),
  a("E-EVIDENCE-SUFFICIENT", true, "sufficient evidence"),
  a("E-VALUE-INCOMPATIBLE", false, "values compatible"),
];

/** The comparable set with named facets overridden. */
function withFacets(overrides: Readonly<Record<string, boolean>>): CorpusEAnswer[] {
  return COMPARABLE.map((answer) => {
    const override = overrides[answer.question];
    return override === undefined ? answer : a(answer.question, override, answer.reason);
  });
}

/**
 * The corpus.
 *
 * A conflict fixture's expert answer makes the derived outcome D-CONFLICT; a
 * difference fixture's expert answer makes it a legitimate D-DIFFERENT-* or
 * D-UPDATED-POSITION, which is not a contradiction and must not be presented.
 */
export const CORPUS: readonly CorpusFixture[] = [
  {
    id: "C1-definition-conflict",
    checkId: "C1",
    deterministicAnswers: COMPARABLE,
    expertAnswers: [a("E-DEFINITION-INCOMPATIBLE", true, "the term is used two ways")],
    expectedDOutcome: "D-CONFLICT",
    expectedPresent: true,
  },
  {
    id: "C1-scenario-difference",
    checkId: "C1",
    deterministicAnswers: withFacets({ "E-SCENARIO-SAME": false }),
    expertAnswers: [a("E-DEFINITION-INCOMPATIBLE", false, "the term is used one way")],
    expectedDOutcome: "D-DIFFERENT-SCENARIO",
    expectedPresent: false,
  },
  {
    id: "C2-numeric-conflict",
    checkId: "C2",
    deterministicAnswers: COMPARABLE,
    expertAnswers: [a("E-VALUE-INCOMPATIBLE", true, "the same figure is given two values")],
    expectedDOutcome: "D-CONFLICT",
    expectedPresent: true,
  },
  {
    id: "C2-numeric-consistent",
    checkId: "C2",
    deterministicAnswers: COMPARABLE,
    expertAnswers: [a("E-VALUE-INCOMPATIBLE", false, "the figures agree")],
    expectedDOutcome: "D-CONSISTENT",
    expectedPresent: false,
  },
  {
    id: "C3-temporal-conflict",
    checkId: "C3",
    deterministicAnswers: COMPARABLE,
    expertAnswers: [a("E-VALUE-INCOMPATIBLE", true, "two dates are given for one event")],
    expectedDOutcome: "D-CONFLICT",
    expectedPresent: true,
  },
  {
    id: "C3-period-difference",
    checkId: "C3",
    deterministicAnswers: withFacets({ "E-TEMPORAL-COMPARABLE": false }),
    expertAnswers: [a("E-VALUE-INCOMPATIBLE", false, "the dates are for different periods")],
    expectedDOutcome: "D-DIFFERENT-PERIOD",
    expectedPresent: false,
  },
  {
    id: "C4-attribute-conflict",
    checkId: "C4",
    deterministicAnswers: COMPARABLE,
    expertAnswers: [a("E-SUBSTANTIVE-CONFLICT", true, "one entity carries two attributes")],
    expectedDOutcome: "D-CONFLICT",
    expectedPresent: true,
  },
  {
    id: "C5-definitional-conflict",
    checkId: "C5",
    deterministicAnswers: COMPARABLE,
    expertAnswers: [a("E-DEFINITION-INCOMPATIBLE", true, "a term is used against its definition")],
    expectedDOutcome: "D-CONFLICT",
    expectedPresent: true,
  },
  {
    id: "C6-unit-conflict",
    checkId: "C6",
    deterministicAnswers: COMPARABLE,
    expertAnswers: [a("E-VALUE-INCOMPATIBLE", true, "one quantity is given two values")],
    expectedDOutcome: "D-CONFLICT",
    expectedPresent: true,
  },
  {
    id: "C6-measurement-basis-difference",
    checkId: "C6",
    deterministicAnswers: withFacets({ "E-CURRENCY-COMPATIBLE": false }),
    expertAnswers: [
      a("E-VALUE-INCOMPATIBLE", false, "the units are incompatible, not contradictory"),
    ],
    expectedDOutcome: "D-DIFFERENT-MEASUREMENT-BASIS",
    expectedPresent: false,
  },
  {
    id: "C7-status-conflict",
    checkId: "C7",
    deterministicAnswers: COMPARABLE,
    expertAnswers: [a("E-STATUS-MUTUALLY-EXCLUSIVE", true, "one thing is stated in two states")],
    expectedDOutcome: "D-CONFLICT",
    expectedPresent: true,
  },
  {
    id: "C7-legitimate-update",
    checkId: "C7",
    deterministicAnswers: COMPARABLE,
    expertAnswers: [a("E-UPDATE-SUPERSEDES", false, "a later claim supersedes the earlier one")],
    expectedDOutcome: "D-UPDATED-POSITION",
    expectedPresent: false,
  },
  {
    id: "C8-reference-conflict",
    checkId: "C8",
    deterministicAnswers: COMPARABLE,
    expertAnswers: [a("E-SUBSTANTIVE-CONFLICT", true, "the reference contradicts the claim")],
    expectedDOutcome: "D-CONFLICT",
    expectedPresent: true,
  },
  {
    id: "C8-reference-difference",
    checkId: "C8",
    deterministicAnswers: COMPARABLE,
    expertAnswers: [
      a("E-SUBSTANTIVE-CONFLICT", false, "the reference does not contradict the claim"),
    ],
    expectedDOutcome: "D-AMBIGUOUS",
    expectedPresent: false,
  },
  {
    id: "C9-section-conflict",
    checkId: "C9",
    deterministicAnswers: COMPARABLE,
    expertAnswers: [a("E-SUBSTANTIVE-CONFLICT", true, "the section fails to deliver its promise")],
    expectedDOutcome: "D-CONFLICT",
    expectedPresent: true,
  },
  {
    id: "C9-section-difference",
    checkId: "C9",
    deterministicAnswers: COMPARABLE,
    expertAnswers: [a("E-SUBSTANTIVE-CONFLICT", false, "the section delivers what it promises")],
    expectedDOutcome: "D-AMBIGUOUS",
    expectedPresent: false,
  },
  {
    id: "C10-scope-conflict",
    checkId: "C10",
    deterministicAnswers: COMPARABLE,
    expertAnswers: [a("E-SUBSTANTIVE-CONFLICT", true, "one claim is qualified two ways")],
    expectedDOutcome: "D-CONFLICT",
    expectedPresent: true,
  },
  {
    id: "C10-scope-difference",
    checkId: "C10",
    deterministicAnswers: withFacets({ "E-SCOPE-SAME": false }),
    expertAnswers: [
      a("E-QUALIFIER-RECONCILES", false, "the scopes differ, so the claims do not conflict"),
    ],
    expectedDOutcome: "D-DIFFERENT-SCOPE",
    expectedPresent: false,
  },
];
