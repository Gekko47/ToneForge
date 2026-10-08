/**
 * System One context policy (R5, original §23).
 *
 * Decides which context a question may ask for, and names the questions a
 * single expansion pass must rerun. The rules are the spec's, verbatim:
 *
 * 1. retrieve only requested context;
 * 2. index-first;
 * 3. never append the whole report;
 * 4. one expansion pass by default;
 * 5. rerun only unanswered questions;
 * 6. still unresolved → insufficient evidence.
 *
 * There is no agentic loop. The policy is pure: it maps a question to the
 * context it needs and, given a set of answers, names the questions still
 * unanswered. It never reads the document itself — retrieval is the engine's
 * job, and keeping the policy pure is what makes it unit-testable without a
 * host or a provider.
 */

import type {
  ContextRequestKind,
  DecisionPlan,
  DecisionQuestion,
} from "@/analysis/consistency/contracts/plan";
import type { EvaluationAnswer } from "@/analysis/consistency/contracts/evaluation";
import type { EQuestion } from "@/analysis/consistency/comparison/deterministicEvaluationResolver";

/**
 * The context each E-question may request.
 *
 * A question that needs no extra context maps to an empty list — the projected
 * state already carries the two claims and their evidence, so most questions
 * ask for nothing. Only the questions whose answer genuinely depends on
 * material outside the pair request it, and each requests the narrowest
 * context that can settle it.
 */
const CONTEXT_BY_QUESTION: Partial<Record<EQuestion, readonly ContextRequestKind[]>> = {
  // Definitional questions need the term's definition, not the whole section.
  "E-DEFINITION-INCOMPATIBLE": ["CTX-TERM-DEFINITION"],
  // Reference questions need the referenced content.
  "E-REFERENCE-SUPPORTS-CLAIM": ["CTX-REFERENCE-CONTENT"],
  // Section-promise questions need the section summary.
  "E-SECTION-FULFILS-PROMISE": ["CTX-SECTION-SUMMARY"],
  // Temporal questions need the surrounding paragraphs to read the period.
  "E-TEMPORAL-COMPARABLE": ["CTX-SURROUNDING-PARAGRAPHS"],
  "E-DATA-DATE-COMPARABLE": ["CTX-SURROUNDING-PARAGRAPHS"],
  "E-ANALYSIS-WINDOW-SAME": ["CTX-SURROUNDING-PARAGRAPHS"],
  "E-VALUATION-PERIOD-SAME": ["CTX-VALUATION-BASIS"],
  // Event and programme questions need the history, not the pair alone.
  "E-EVENT-SAME": ["CTX-EVENT-HISTORY"],
  "E-PROGRAMME-BASIS-SAME": ["CTX-PROGRAMME-HISTORY"],
  // Basis questions need the valuation or measurement basis.
  "E-BASIS-SAME": ["CTX-VALUATION-BASIS"],
  "E-MEASUREMENT-BASIS-SAME": ["CTX-MEASUREMENT-BASIS"],
  // Update questions need related claims to see what superseded what.
  "E-UPDATE-SUPERSEDES": ["CTX-RELATED-CLAIMS"],
};

/** The context a single E-question may request. Empty when none is needed. */
export function contextRequestsForQuestion(eQuestion: EQuestion): readonly ContextRequestKind[] {
  return CONTEXT_BY_QUESTION[eQuestion] ?? [];
}

/**
 * The context a compiled question requests.
 *
 * The question id is `<candidateId>:<eQuestion>`, so the E-question name is
 * recovered by stripping the candidate prefix — the same convention the engine
 * uses when it maps answers back.
 */
export function contextRequestsForDecisionQuestion(
  question: DecisionQuestion,
): readonly ContextRequestKind[] {
  const separator = question.id.indexOf(":");
  const eQuestion = (
    separator === -1 ? question.id : question.id.slice(separator + 1)
  ) as EQuestion;
  return contextRequestsForQuestion(eQuestion);
}

/**
 * The questions still unanswered after one pass.
 *
 * An answer is "unanswered" when it is missing, `unclear`, or carries zero
 * confidence — the three ways a model declines to commit. Only these are
 * rerun; a question the model answered is never asked twice, which is what
 * keeps the expansion to a single bounded pass rather than a loop.
 */
export function unansweredQuestions(
  plan: DecisionPlan,
  answers: readonly EvaluationAnswer[],
): DecisionQuestion[] {
  const byQuestion = new Map(answers.map((answer) => [answer.question, answer]));
  return plan.questions.filter((question) => {
    const answer = byQuestion.get(question.id);
    if (answer === undefined) return true;
    if (answer.answer === "unclear") return true;
    return answer.confidence <= 0;
  });
}
