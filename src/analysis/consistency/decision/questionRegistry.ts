/**
 * Question registry (R5, original §17, §19).
 *
 * Versioned registry of all E-questions mapped to typed DecisionQuestions
 * per C-check profile. The registry is the contract between the plan
 * compiler and the decision provider.
 */

import type { ConsistencyCheckId } from "../contracts/registry";
import type { DecisionQuestion } from "../contracts/plan";
import type { EQuestion } from "../comparison/deterministicEvaluationResolver";
import { evaluationProfile, allRelevantEQuestions } from "../comparison/evaluationProfiles";

/** Version of the question set. Increment when questions change. */
export const QUESTION_SET_VERSION = "1.0";

/** A registry entry mapping an E-question to a typed DecisionQuestion. */
export interface QuestionRegistryEntry {
  readonly eQuestion: EQuestion;
  readonly decisionQuestion: DecisionQuestion;
  /** Which checks this question applies to. */
  readonly checks: readonly ConsistencyCheckId[];
}

/** The question registry. */
export interface QuestionRegistry {
  readonly version: string;
  readonly entries: readonly QuestionRegistryEntry[];
  /** Get the decision question for an E-question and check. */
  getQuestion(eQuestion: EQuestion, checkId: ConsistencyCheckId): DecisionQuestion | undefined;
  /** Get all questions for a check. */
  getQuestionsForCheck(checkId: ConsistencyCheckId): readonly DecisionQuestion[];
}

/** Build the registry from evaluation profiles. */
export function buildQuestionRegistry(): QuestionRegistry {
  const entries: QuestionRegistryEntry[] = [];

  // Map each E-question to a typed DecisionQuestion
  // The mapping is based on the question's nature (binary, choice, score)
  const questionMap = new Map<EQuestion, DecisionQuestion>();

  // Binary questions
  const binaryQuestions: EQuestion[] = [
    "E-ENTITY-SAME",
    "E-EVENT-SAME",
    "E-PREDICATE-COMPARABLE",
    "E-SCOPE-SAME",
    "E-SCENARIO-SAME",
    "E-ATTRIBUTION-COMPATIBLE",
    "E-MODALITY-COMPATIBLE",
    "E-TEMPORAL-COMPARABLE",
    "E-BASIS-SAME",
    "E-VALUE-INCOMPATIBLE",
    "E-QUALIFIER-RECONCILES",
    "E-EVIDENCE-SUFFICIENT",
    "E-UPDATE-SUPERSEDES",
    "E-PROGRAMME-BASIS-SAME",
    "E-DATA-DATE-COMPARABLE",
    "E-ANALYSIS-WINDOW-SAME",
    "E-CRITICALITY-INCOMPATIBLE",
    "E-CONCURRENCY-RECONCILES",
    "E-MEASUREMENT-BASIS-SAME",
    "E-VALUATION-PERIOD-SAME",
    "E-CURRENCY-COMPATIBLE",
    "E-INCLUSIONS-SAME",
    "E-STATUS-MUTUALLY-EXCLUSIVE",
    "E-SCOPE-EXCEPTION",
    "E-SUBSTANTIVE-CONFLICT",
  ];

  for (const eq of binaryQuestions) {
    questionMap.set(eq, {
      kind: "binary",
      id: eq,
      prompt: binaryPrompt(eq),
      subjectId: "",
      requestedContext: [],
    });
  }

  // Choice questions
  const choiceQuestions: EQuestion[] = [
    "E-DEFINITION-INCOMPATIBLE",
    "E-REFERENCE-SUPPORTS-CLAIM",
    "E-SECTION-FULFILS-PROMISE",
  ];

  for (const eq of choiceQuestions) {
    questionMap.set(eq, {
      kind: "choice",
      id: eq,
      prompt: choicePrompt(eq),
      subjectId: "",
      options: choiceOptions(eq),
      requestedContext: [],
    });
  }

  // Build entries from all relevant E-questions
  for (const eq of allRelevantEQuestions()) {
    const base = questionMap.get(eq);
    if (base !== undefined) {
      // Find which checks use this question
      const checks: ConsistencyCheckId[] = [];
      for (const checkId of [
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
      ] as ConsistencyCheckId[]) {
        const profile = evaluationProfile(checkId);
        if (profile.relevantEQuestions.includes(eq)) {
          checks.push(checkId);
        }
      }
      entries.push({
        eQuestion: eq,
        decisionQuestion: { ...base }, // subjectId filled at compile time
        checks,
      });
    }
  }

  return {
    version: QUESTION_SET_VERSION,
    entries,
    getQuestion(eQuestion: EQuestion, checkId: ConsistencyCheckId): DecisionQuestion | undefined {
      const entry = entries.find((e) => e.eQuestion === eQuestion && e.checks.includes(checkId));
      return entry?.decisionQuestion;
    },
    getQuestionsForCheck(checkId: ConsistencyCheckId): readonly DecisionQuestion[] {
      return entries.filter((e) => e.checks.includes(checkId)).map((e) => e.decisionQuestion);
    },
  };
}

/** The singleton registry instance. */
export const QUESTION_REGISTRY = buildQuestionRegistry();

/** Prompt templates for binary questions. */
function binaryPrompt(eq: EQuestion): string {
  const prompts: Partial<Record<EQuestion, string>> = {
    "E-ENTITY-SAME": "Do both claims refer to the same entity?",
    "E-EVENT-SAME": "Do both claims refer to the same event?",
    "E-PREDICATE-COMPARABLE": "Are the predicates comparable (same metric/attribute)?",
    "E-SCOPE-SAME": "Do both claims have the same scope kind?",
    "E-SCENARIO-SAME": "Are both claims in the same scenario (baseline/forecast/actual)?",
    "E-ATTRIBUTION-COMPATIBLE": "Are the attributions compatible (same speaker/attributedTo)?",
    "E-MODALITY-COMPATIBLE": "Are the modalities compatible (assertion/assumption/conditional)?",
    "E-TEMPORAL-COMPARABLE": "Are the dates in the shared temporal role comparable?",
    "E-BASIS-SAME": "Do both claims cite the same contractual basis?",
    "E-VALUE-INCOMPATIBLE": "Are the values incompatible after unit conversion?",
    "E-QUALIFIER-RECONCILES": "Do the qualifiers reconcile the apparent difference?",
    "E-EVIDENCE-SUFFICIENT": "Do both claims have sufficient evidence anchors?",
    "E-UPDATE-SUPERSEDES":
      "Do both claims have the same adoption status (so neither supersedes the other)?",
    "E-PROGRAMME-BASIS-SAME": "Do both claims reference the same programme basis?",
    "E-DATA-DATE-COMPARABLE": "Are the data dates comparable?",
    "E-ANALYSIS-WINDOW-SAME": "Are the analysis windows the same?",
    "E-CRITICALITY-INCOMPATIBLE": "Are the criticality assessments incompatible?",
    "E-CONCURRENCY-RECONCILES": "Do the concurrency claims reconcile?",
    "E-MEASUREMENT-BASIS-SAME": "Are the measurement bases (analysis methods) the same?",
    "E-VALUATION-PERIOD-SAME": "Are the valuation periods the same?",
    "E-CURRENCY-COMPATIBLE": "Are the currencies compatible?",
    "E-INCLUSIONS-SAME": "Are the quantum inclusions (gross/net/tax/overhead/profit) the same?",
    "E-STATUS-MUTUALLY-EXCLUSIVE": "Are the status words mutually exclusive?",
    "E-SCOPE-EXCEPTION": "Is one claim universal and the other an exception?",
    "E-SUBSTANTIVE-CONFLICT": "Is there a substantive conflict proven?",
  };
  return prompts[eq] ?? `Evaluate: ${eq}`;
}

/** Prompt templates for choice questions. */
function choicePrompt(eq: EQuestion): string {
  const prompts: Partial<Record<EQuestion, string>> = {
    "E-DEFINITION-INCOMPATIBLE": "Are the term definitions incompatible?",
    "E-REFERENCE-SUPPORTS-CLAIM": "Does the reference support or contradict the claim?",
    "E-SECTION-FULFILS-PROMISE": "Does the section content fulfil the heading promise?",
  };
  return prompts[eq] ?? `Evaluate: ${eq}`;
}

/** Options for choice questions. */
function choiceOptions(eq: EQuestion): string[] {
  const options: Partial<Record<EQuestion, string[]>> = {
    "E-DEFINITION-INCOMPATIBLE": ["compatible", "incompatible", "unclear"],
    "E-REFERENCE-SUPPORTS-CLAIM": ["supports", "contradicts", "neutral", "unclear"],
    "E-SECTION-FULFILS-PROMISE": ["fulfils", "contradicts", "partial", "unclear"],
  };
  return options[eq] ?? ["yes", "no", "unclear"];
}
