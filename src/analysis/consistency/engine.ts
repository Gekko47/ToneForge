/**
 * The cross-report consistency engine (Phase 5).
 *
 * This is the **single sanctioned exception** to ToneForge's deterministic-first
 * rule, per ADR-0052. Four properties of the pipeline are load-bearing:
 *
 * 1. **It is never called from the typing path.** Nothing in `word/`, nothing in
 *    the observer, and nothing on an incremental path may call `runConsistencyReview`.
 *    A cross-report check over a moving document returns different answers as
 *    the text shifts underneath it, which is a correctness problem, not a
 *    performance one. The engine therefore runs on a whole-document snapshot the
 *    user explicitly chose to review, and refuses a request whose revision has
 *    since changed.
 * 2. **It gates on its own consent.** `parseConsistencyReviewRequest` throws
 *    without `consistencyConsent: true`. No other consent in the product implies
 *    it.
 * 3. **Deterministic comparison comes first.** The ten checks run before anything
 *    is sent anywhere. Only candidates the checks could not settle are escalated.
 * 4. **It reports its own coverage.** The pairwise comparison is quadratic, so it
 *    is bounded, and the bound appears in the report rather than being applied
 *    quietly. A truncated review that reads as a complete one is the failure mode
 *    that matters here.
 */

import { z } from "zod";
import type { LlmProvider } from "../../ai/providers/LlmProvider";
import { logger } from "../../shared/utils/logger";
import { CONSISTENCY_CHECKS, type ConsistencyCandidate } from "./contracts";
import {
  CONSISTENCY_ACTIONABLE_CONFIDENCE,
  ConsistencyCoverageSchema,
  ConsistencyReportSchema,
  parseConsistencyReviewRequest,
  type ConsistencyAdjudication,
  type ConsistencyCheckId,
  type ConsistencyIssue,
  type ConsistencyProgress,
  type ConsistencyReport,
  type ConsistencyReviewRequest,
  type ConsistencyStatement,
} from "./contracts";
import { CONSISTENCY_CHECKERS, type IndexedStatement } from "./checks";
import { splitSentences } from "./checks/primitives";

/** Thrown when a run is superseded or cancelled. Not a bug; a normal outcome. */
export class ConsistencyRunCancelled extends Error {
  constructor(
    message: string,
    public readonly reason: "cancelled" | "stale",
  ) {
    super(message);
    this.name = "ConsistencyRunCancelled";
  }
}

export interface ConsistencyRunOptions {
  /**
   * The already-configured provider.
   *
   * Optional on purpose: a run with no provider still performs every
   * deterministic comparison and reports which candidates went unadjudicated.
   * Degrading is better than refusing, because the deterministic half is
   * genuinely useful on its own.
   */
  readonly provider?: LlmProvider;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ConsistencyProgress) => void;
  /**
   * The document's current revision, checked again before the report is
   * returned. A run whose document changed underneath it throws rather than
   * reporting findings against text the user is no longer looking at.
   */
  readonly currentRevision?: () => string;
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

/**
 * Split a snapshot into statements, tracking the section each came from.
 *
 * A markdown heading (`## Title`) starts a new section. Offsets are relative to
 * the whole snapshot so a finding can be navigated back to real text.
 */
export function segmentDocument(
  text: string,
  headings: readonly string[],
): { statements: IndexedStatement[]; headings: string[] } {
  const statements: IndexedStatement[] = [];
  const foundHeadings: string[] = [];
  let currentSection = "";
  let offset = 0;
  let counter = 0;

  for (const line of text.split("\n")) {
    const headingMatch = /^\s{0,3}#{1,6}\s+(.*\S)\s*$/.exec(line);
    if (headingMatch?.[1] !== undefined) {
      currentSection = headingMatch[1];
      if (!foundHeadings.includes(currentSection)) foundHeadings.push(currentSection);
      offset += line.length + 1;
      continue;
    }
    for (const sentence of splitSentences(line)) {
      const start = text.indexOf(sentence, offset);
      const safeStart = start === -1 ? offset : start;
      statements.push({
        statement: {
          id: `s${counter}`,
          section: currentSection,
          text: sentence,
          start: safeStart,
          end: safeStart + sentence.length,
        },
        index: counter,
      });
      counter += 1;
    }
    offset += line.length + 1;
  }

  // Headings the caller declared but the text did not contain are still
  // headings; a section with no body is an empty section, not a missing one.
  for (const declared of headings) {
    if (!foundHeadings.includes(declared)) foundHeadings.push(declared);
  }
  return { statements, headings: foundHeadings };
}

// ---------------------------------------------------------------------------
// Adjudication
// ---------------------------------------------------------------------------

const AdjudicationPayloadSchema = z.object({
  verdict: z.enum(["contradiction", "notAConflict", "unclear"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().trim().min(1),
  atFault: z.enum(["left", "right"]).optional(),
});

/**
 * A parsed verdict plus whether a real reviewer actually produced it.
 *
 * `answered` is what separates "the model said it could not tell" from "no model
 * was asked, or the request failed, or the answer was unreadable". The first is a
 * review that happened; the others are conflicts nobody looked at, and the
 * coverage report has to be able to tell them apart.
 */
interface AdjudicationOutcome {
  readonly adjudication: ConsistencyAdjudication;
  readonly answered: boolean;
}

/**
 * Parse a model's verdict.
 *
 * An unreadable answer is `unclear`, never `contradiction`. A malformed
 * response must not become a finding: the safe reading of "I could not parse
 * this" is "there is no conclusion", which is the same as the check being
 * unsure.
 */
function readAdjudication(text: string, candidate: ConsistencyCandidate): AdjudicationOutcome {
  let payload: string | null = null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    payload = raw.slice(start, end + 1);
  }
  if (payload === null) {
    return {
      adjudication: {
        checkId: candidate.checkId,
        fingerprint: candidate.fingerprint,
        verdict: "unclear",
        confidence: 0,
        rationale: "The reviewer's answer could not be read, so no conclusion was drawn.",
      },
      answered: false,
    };
  }
  try {
    const parsed = AdjudicationPayloadSchema.safeParse(JSON.parse(payload));
    if (!parsed.success) {
      return {
        adjudication: {
          checkId: candidate.checkId,
          fingerprint: candidate.fingerprint,
          verdict: "unclear",
          confidence: 0,
          rationale: "The reviewer's answer did not match the expected shape.",
        },
        answered: false,
      };
    }
    return {
      adjudication: {
        checkId: candidate.checkId,
        fingerprint: candidate.fingerprint,
        verdict: parsed.data.verdict,
        confidence: parsed.data.confidence,
        rationale: parsed.data.rationale,
        ...(parsed.data.atFault === undefined ? {} : { atFault: parsed.data.atFault }),
      },
      answered: true,
    };
  } catch {
    return {
      adjudication: {
        checkId: candidate.checkId,
        fingerprint: candidate.fingerprint,
        verdict: "unclear",
        confidence: 0,
        rationale: "The reviewer's answer was not valid JSON, so no conclusion was drawn.",
      },
      answered: false,
    };
  }
}

export function parseAdjudication(
  text: string,
  candidate: ConsistencyCandidate,
): ConsistencyAdjudication {
  return readAdjudication(text, candidate).adjudication;
}

/** The prompt sent for one ambiguous candidate. Carries only the two statements. */
export function buildAdjudicationPrompt(candidate: ConsistencyCandidate): string {
  const check = CONSISTENCY_CHECKS[candidate.checkId];
  return [
    `Check ${candidate.checkId}: ${check.title}`,
    `Question: ${check.question}`,
    "",
    "Statement A:",
    candidate.left.text,
    "",
    "Statement B:",
    candidate.right.text,
    "",
    "Do these two statements contradict each other?",
    "Answer with JSON only, no prose:",
    '{"verdict":"contradiction|notAConflict|unclear","confidence":0.0,"rationale":"one sentence","atFault":"left|right"}',
  ].join("\n");
}

async function adjudicate(
  candidate: ConsistencyCandidate,
  options: ConsistencyRunOptions,
): Promise<AdjudicationOutcome> {
  if (options.provider === undefined) {
    return {
      adjudication: {
        checkId: candidate.checkId,
        fingerprint: candidate.fingerprint,
        verdict: "unclear",
        confidence: 0,
        rationale: "No language model was configured for this review.",
      },
      answered: false,
    };
  }
  try {
    const response = await options.provider.complete({
      prompt: buildAdjudicationPrompt(candidate),
      systemPrompt:
        "You compare two statements from a document and judge whether they contradict each other. Answer with JSON only. When the statements could both be true, answer notAConflict. When you cannot tell, answer unclear.",
      temperature: 0,
      maxTokens: 300,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return readAdjudication(response.text, candidate);
  } catch (error) {
    if (isAbort(error)) throw new ConsistencyRunCancelled("Review cancelled.", "cancelled");
    // A provider failure must not abort the run: the deterministic findings are
    // still valid, and losing them because a request timed out would be a worse
    // outcome than reporting fewer.
    logger.warn("Consistency adjudication failed; candidate left undecided", {
      checkId: candidate.checkId,
      kind: error instanceof Error ? error.name : "unknown",
    });
    return {
      adjudication: {
        checkId: candidate.checkId,
        fingerprint: candidate.fingerprint,
        verdict: "unclear",
        confidence: 0,
        rationale: "The reviewer could not be reached, so no conclusion was drawn.",
      },
      answered: false,
    };
  }
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof ConsistencyRunCancelled ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

// ---------------------------------------------------------------------------
// Consolidation
// ---------------------------------------------------------------------------

/**
 * Turn candidates and verdicts into issues.
 *
 * Three rules, each about not overstating what was found:
 * - only a `contradiction` becomes an issue;
 * - a `certain` candidate needs no model, and is reported at full confidence
 *   because the comparison decided it;
 * - `unclear` is the same as no finding. A run that cannot explain itself is not
 *   a run that found a problem.
 */
export function consolidate(
  candidates: readonly ConsistencyCandidate[],
  verdicts: ReadonlyMap<string, ConsistencyAdjudication>,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  for (const candidate of candidates) {
    const descriptor = CONSISTENCY_CHECKS[candidate.checkId];
    if (candidate.certainty === "certain") {
      // A deterministic candidate settled the comparison itself, so there is no
      // adjudicator to say which side is wrong. Naming a side here would be the
      // engine guessing at fault, which is the one thing it must not do.
      issues.push(toIssue(candidate, 1, descriptor.severity));
      continue;
    }
    const verdict = verdicts.get(candidate.fingerprint);
    if (verdict === undefined) continue;
    if (verdict.verdict !== "contradiction") continue;
    issues.push(toIssue(candidate, verdict.confidence, descriptor.severity, verdict));
  }
  return issues;
}

function toIssue(
  candidate: ConsistencyCandidate,
  confidence: number,
  severity: "warning" | "error",
  adjudication?: ConsistencyAdjudication,
): ConsistencyIssue {
  const descriptor = CONSISTENCY_CHECKS[candidate.checkId];
  // Only the adjudicator may name a faulty side. A deterministic candidate has
  // no adjudicator, so it reports the conflict and points at nothing.
  const atFault =
    adjudication?.atFault === "left"
      ? candidate.left
      : adjudication?.atFault === "right"
        ? candidate.right
        : undefined;
  return {
    checkId: candidate.checkId,
    fingerprint: candidate.fingerprint,
    title: descriptor.title,
    detail: candidate.suspicion,
    severity,
    confidence,
    // A low-confidence finding is shown but cannot drive a change on its own.
    // A non-deterministic engine that quietly rewrites prose is worse than one
    // that asks.
    actionable: confidence >= CONSISTENCY_ACTIONABLE_CONFIDENCE,
    nodeIds: [candidate.left.id, candidate.right.id],
    ranges: {
      left: { start: candidate.left.start, end: candidate.left.end },
      right: { start: candidate.right.start, end: candidate.right.end },
    },
    evidence: {
      left: candidate.left.text,
      right: candidate.right.text,
      sectionLeft: candidate.left.section,
      sectionRight: candidate.right.section,
    },
    // No `suggestedText`: this engine compares statements, it does not write
    // replacements. A "suggested" value here was the faulty statement's own text,
    // which reads as a fix and is nothing of the kind.
    ...(atFault === undefined ? {} : { suggestedNodeId: atFault.id }),
  };
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Run a whole-document cross-report consistency review.
 *
 * The entry point the task pane calls. Never call it from an incremental path.
 */
export async function runConsistencyReview(
  rawRequest: unknown,
  options: ConsistencyRunOptions = {},
): Promise<ConsistencyReport> {
  // Throws without the engine's own consent. Deliberately the first thing that
  // happens, before any text is read.
  const request: ConsistencyReviewRequest = parseConsistencyReviewRequest(rawRequest);
  const clock = options.now ?? (() => new Date());
  // Captured once, at the top. Reading the clock again at the end would make
  // `startedAt` a second-boundary-later value under a real clock, which reads as
  // a run that started after it finished.
  const startedAt = clock().toISOString();

  const report = (progress: ConsistencyProgress): void => options.onProgress?.(progress);

  report({ phase: "segmenting", fraction: 0.05, message: "Reading the document…" });
  assertNotCancelled(options);
  assertCurrent(request, options);

  const { statements, headings } = segmentDocument(
    request.document.text,
    request.document.sections,
  );
  const total = statements.length;
  const limited = statements.slice(0, request.maxStatements);
  const limitations: string[] = [];
  if (total > limited.length) {
    limitations.push(
      `Compared the first ${limited.length} of ${total} statements. Cross-report comparison is pairwise, so a longer document needs either a higher limit or a second run.`,
    );
  }

  // --- compare -------------------------------------------------------------
  const perCheck: Record<string, number> = {};
  const candidates: ConsistencyCandidate[] = [];
  const selected = new Set<ConsistencyCheckId>(request.checks);
  const activeCheckers = CONSISTENCY_CHECKERS.filter((checker) => selected.has(checker.id));
  activeCheckers.forEach((checker, index) => {
    assertNotCancelled(options);
    report({
      phase: "comparing",
      fraction: 0.1 + (0.5 * (index + 1)) / Math.max(activeCheckers.length, 1),
      message: `Checking ${checker.id} — ${CONSISTENCY_CHECKS[checker.id].title}…`,
    });
    const found = checker.run({ statements: limited, headings });
    perCheck[checker.id] = found.length;
    candidates.push(...found);
  });

  // Checks that were not selected are reported as zero rather than omitted, so
  // a coverage report never implies a check ran when it did not.
  CONSISTENCY_CHECKERS.forEach((checker) => {
    if (perCheck[checker.id] === undefined) perCheck[checker.id] = 0;
  });

  // --- adjudicate ----------------------------------------------------------
  const ambiguous = candidates.filter((candidate) => candidate.certainty === "ambiguous");
  const toAdjudicate = ambiguous.slice(0, request.maxAdjudications);
  const verdicts = new Map<string, ConsistencyAdjudication>();
  let answeredCount = 0;
  for (const [index, candidate] of toAdjudicate.entries()) {
    assertNotCancelled(options);
    report({
      phase: "adjudicating",
      fraction: 0.6 + (0.3 * (index + 1)) / Math.max(toAdjudicate.length, 1),
      message: `Reviewing candidate ${index + 1} of ${toAdjudicate.length}…`,
    });
    const outcome = await adjudicate(candidate, options);
    verdicts.set(candidate.fingerprint, outcome.adjudication);
    if (outcome.answered) answeredCount += 1;
  }

  // --- consolidate ---------------------------------------------------------
  report({ phase: "consolidating", fraction: 0.92, message: "Collecting results…" });
  assertNotCancelled(options);
  const issues = consolidate(candidates, verdicts);
  assertCurrent(request, options);

  // A conflict is unreviewed when it needed the model and no usable answer came
  // back — no provider, a failed request, an unreadable reply, or a candidate
  // past the cap. Provider presence is not the test: a run where every request
  // failed reviewed nothing, and reporting that as complete is the failure this
  // engine exists to avoid.
  const unreviewed = ambiguous.length - answeredCount;
  if (unreviewed > 0) {
    limitations.push(
      options.provider === undefined
        ? `${unreviewed} candidate conflict${unreviewed === 1 ? "" : "s"} could not be reviewed because no language model is configured. Only the deterministic findings are reported.`
        : `${unreviewed} candidate conflict${unreviewed === 1 ? "" : "s"} could not be reviewed — the reviewer was unavailable, failed, or the run reached its adjudication limit. Only the deterministic findings are reported.`,
    );
  }
  if (ambiguous.length > toAdjudicate.length) {
    limitations.push(
      `Reviewed the first ${toAdjudicate.length} of ${ambiguous.length} candidate conflicts. The rest were not sent for review.`,
    );
  }

  const usedModel = answeredCount > 0;

  const coverage = ConsistencyCoverageSchema.parse({
    // Complete means every statement was compared *and* every candidate that
    // needed a judgement got one. With no ambiguous candidates there was nothing
    // to judge, so a run without a provider is genuinely complete.
    complete: total <= limited.length && unreviewed === 0,
    statementsConsidered: limited.length,
    statementsTotal: total,
    comparisonsMade: (limited.length * (limited.length - 1)) / 2,
    perCheck,
    limitations,
    modelAdjudicated: answeredCount,
  });

  report({ phase: "done", fraction: 1, message: "Consistency review complete." });

  return ConsistencyReportSchema.parse({
    revision: request.document.revision,
    issues,
    coverage,
    usedModel,
    startedAt,
    finishedAt: clock().toISOString(),
  });
}

function assertNotCancelled(options: ConsistencyRunOptions): void {
  if (options.signal?.aborted === true) {
    throw new ConsistencyRunCancelled("Consistency review cancelled.", "cancelled");
  }
}

/**
 * Refuse to report against a document that has changed since the run started.
 *
 * The findings name character offsets and quote text. If the document moved
 * underneath the run, those references point somewhere else, so the run fails
 * rather than reporting a conflict against text the user is not looking at.
 */
function assertCurrent(request: ConsistencyReviewRequest, options: ConsistencyRunOptions): void {
  const current = options.currentRevision?.();
  if (current === undefined) return;
  if (current !== request.document.revision) {
    throw new ConsistencyRunCancelled(
      "The document changed while the consistency review was running; the results were discarded.",
      "stale",
    );
  }
}

/** Build statements without running the pipeline, for previews and tests. */
export function previewStatements(
  text: string,
  headings: readonly string[] = [],
): ConsistencyStatement[] {
  return segmentDocument(text, headings).statements.map((entry) => entry.statement);
}

export { CONSISTENCY_ACTIONABLE_CONFIDENCE } from "./contracts";
