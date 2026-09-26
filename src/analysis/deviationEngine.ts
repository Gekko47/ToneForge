/**
 * Semantic style deviation engine (Stage 19).
 *
 * Detects semantic deviations of a target text from a canonical StyleProfile
 * via the provider-agnostic LLM layer. Raw text is only sent to the LLM when
 * the caller explicitly opts in.
 *
 * Boundary rule: this module is semantic, not deterministic. It may import
 * from `core/domain`, `ai/providers`, `ai/prompts`, and `shared/utils`, but
 * it must not import `ui` or `word/revisionAdapter` (see ADR-0023 and the
 * `src/analysis/**` ESLint scope). It emits `Finding` objects with
 * `kind: "semantic"` for `unifyFindings()` and the Stage 17 planner, which
 * preserves semantic findings without forced change mapping.
 */

import { v4 as uuidv4 } from "uuid";
import { buildDeviationPrompt, DeviationResponseSchema } from "../ai/prompts/profilePrompts";
import { createLlmRegistry } from "../ai/providers/registry";
import { LlmError, type LlmSemanticProvider } from "../ai/providers/LlmProvider";
import { withRetry } from "../ai/providers/retry";
import { logger } from "../shared/utils/logger";
import { type Finding, type Severity } from "../core/domain/Finding";
import { type DocumentNode } from "../core/domain/DocumentSnapshot";
import { resolveAnchor } from "./anchorResolution";
import { type StyleProfile } from "../core/domain/StyleProfile";

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 1000;

/** Semantic confidence is always below 1: model output is interpretive. */
const SEMANTIC_CONFIDENCE = 0.7;

const SEVERITY_BY_DEVIATION: Record<string, Severity> = {
  low: "info",
  medium: "warning",
  high: "error",
};

export interface DeviationOptions {
  /** Explicit consent to send raw target text to the LLM. */
  includeRawText: true;
  signal?: AbortSignal;
  registry?: LlmSemanticProvider;
}

/**
 * Detect semantic deviations of `targetText` from `profile`.
 *
 * The caller must pass `includeRawText: true` to authorize sending the raw
 * text to the LLM. The prompt builder enforces this gate before any network
 * request is made. Empty target text short-circuits to an empty array
 * without calling the provider.
 *
 * Each validated deviation is anchored to a real span. The model must quote the
 * text it is describing, and that quote is resolved against `nodes`: on a unique
 * match the finding is `actionable`, carries the node id, and a document-absolute
 * range plus an exact `actual`/`expected` pair, so the planner can produce a
 * change with a real precondition. A quote that is absent, ambiguous, or in a
 * node with no document offset yields an advisory finding that states which of
 * those happened — never an invented offset.
 *
 * Being plannable is not being safe: an anchored semantic change is still
 * AI-sourced and medium-risk, so it still requires approval. Entries that fail
 * schema validation are skipped (logged) rather than fatal.
 */
export async function detectSemanticDeviations(
  targetText: string,
  profile: StyleProfile,
  opts: DeviationOptions,
  /**
   * The acquired nodes the anchor is verified against.
   *
   * Without them an anchor cannot be resolved, so every finding would be
   * reported but unaddressable — which is the state this engine was in before
   * anchoring existed, and the reason the `semanticOptIn` toggle could only
   * ever produce advisory text.
   */
  nodes: readonly DocumentNode[] = [],
): Promise<Finding[]> {
  if (targetText.trim().length === 0) {
    return [];
  }

  const prompt = buildDeviationPrompt(profile, targetText, {
    includeRawText: opts.includeRawText,
  });

  const registry = opts.registry ?? createLlmRegistry();

  const response = await withRetry(
    () =>
      registry.deviations({
        prompt,
        ...(opts.signal ? { signal: opts.signal } : {}),
      }),
    {
      maxRetries: DEFAULT_MAX_RETRIES,
      baseDelayMs: DEFAULT_BASE_DELAY_MS,
      maxDelayMs: DEFAULT_MAX_DELAY_MS,
      isRetryable: (err: unknown) => {
        if (err instanceof LlmError) return err.retryable;
        return !opts.signal?.aborted;
      },
    },
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    throw new Error("Semantic deviation response is not valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Semantic deviation response must be a JSON array");
  }

  const findings: Finding[] = [];
  for (const entry of parsed) {
    const result = DeviationResponseSchema.safeParse(entry);
    if (!result.success) {
      logger.warn("Skipping invalid semantic deviation entry", {
        issues: result.error.issues.map((issue) => issue.message),
      });
      continue;
    }
    // Resolve the model's quote against the real document. A finding with a
    // verified span is addressable and plannable; one without stays advisory and
    // says why, rather than being emitted against the whole document.
    const anchor = resolveAnchor(result.data.anchor, nodes);
    if (!anchor.ok) {
      findings.push({
        id: uuidv4(),
        kind: "semantic",
        category: "semantic-deviation",
        range: { start: 0, end: targetText.length, unit: "character" },
        message: result.data.suggestion,
        severity: SEVERITY_BY_DEVIATION[result.data.severity] ?? "warning",
        evidence: result.data.deviation,
        confidence: SEMANTIC_CONFIDENCE,
        actionable: false,
        advisoryReason: anchor.reason,
        nodeIds: [],
        source: "ai",
        risk: "medium",
        reversible: true,
        status: "deferred",
      });
      continue;
    }

    const node = nodes.find((item) => item.nodeId === anchor.nodeId);
    const base = node?.sourceRange?.startOffset ?? 0;
    findings.push({
      id: uuidv4(),
      kind: "semantic",
      category: "semantic-deviation",
      // Document-absolute, not node-relative: a range measured from the node's own
      // text start points into whatever happens to sit there in someone else's
      // document.
      range: { start: base + anchor.start, end: base + anchor.end, unit: "character" },
      message: result.data.suggestion,
      severity: SEVERITY_BY_DEVIATION[result.data.severity] ?? "warning",
      evidence: result.data.deviation,
      // The anchor is quoted text, so the precondition is exact: if the document
      // no longer contains it, the plan is refused rather than applied blind.
      actual: result.data.anchor,
      expected: result.data.suggestion,
      confidence: SEMANTIC_CONFIDENCE,
      // Semantic output is still interpretive, so the change still requires
      // approval. Being plannable is not the same as being safe to apply.
      actionable: true,
      nodeIds: [anchor.nodeId],
      source: "ai",
      risk: "medium",
      reversible: true,
      status: "new",
    });
  }
  return findings;
}
