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
 * Each validated deviation maps to an advisory, non-actionable `Finding` with
 * `kind: "semantic"`, `category: "semantic-deviation"`, AI provenance, and a
 * full-text range. Vague model deviations are never mapped to invented precise
 * offsets. Entries that fail schema validation are skipped (logged) rather than
 * fatal.
 */
export async function detectSemanticDeviations(
  targetText: string,
  profile: StyleProfile,
  opts: DeviationOptions,
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
      advisoryReason: "Full-document semantic deviation has no locally verified target span",
      nodeIds: [],
      source: "ai",
      risk: "medium",
      reversible: true,
      status: "deferred",
    });
  }
  return findings;
}
