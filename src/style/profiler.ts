/**
 * Semantic style profiler.
 *
 * Builds a StyleProfile from a captured writing sample by combining deterministic
 * measurements with an LLM-derived semantic profile. Raw text is only sent to
 * the LLM when the caller explicitly opts in.
 *
 * Boundary rule: this module is semantic, not deterministic. It may import from
 * ai/providers and ai/prompts, but it must not access Office or mutate the
 * document directly.
 */

import {
  buildProfilePrompt,
  buildProfilePromptV2,
  ProfileResponseSchema,
} from "../ai/prompts/profilePrompts";
import {
  parseSemanticStyleExtraction,
  type ExtractionRefusal,
} from "../analysis/semantic/semanticStyleExtraction";
import { createLlmRegistry } from "../ai/providers/registry";
import { LlmError, type LlmSemanticProvider } from "../ai/providers/LlmProvider";
import { withRetry } from "../ai/providers/retry";
import { createEmptyProfile, type StyleProfile } from "../core/domain/StyleProfile";
import { migrateSemanticStyleFromV1 } from "../core/domain/SemanticStyleProfile";
import { computeMeasuredProfile } from "./metrics";
import type { CapturedSample } from "./sampleCapture";

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 1000;

export interface ProfileOptions {
  /** Explicit consent to send raw sample text to the LLM. */
  includeRawText: true;
  constraints?: string[];
  signal?: AbortSignal;
  registry?: LlmSemanticProvider;
  name?: string;
  /**
   * Which prompt to send. Defaults to `"v2"`.
   *
   * **Not a compatibility shim — a switch with a reason.** The V1 path stays
   * reachable until P4 because the V1 prompt is what the Semantic tab is still
   * calling, and switching it silently would make a provider that only answers
   * the old shape look like a regression rather than a mismatch. It is a
   * parameter rather than a fallback for the same reason: a fallback that
   * quietly retried V1 on a V2 failure would report an all-default profile as
   * learned, which is the one outcome this whole phase exists to prevent.
   */
  promptVersion?: "v1" | "v2";
}

/** Thrown when a provider's answer cannot be used, carrying the reason. */
export class StyleExtractionError extends Error {
  readonly refusal: ExtractionRefusal;
  constructor(refusal: ExtractionRefusal) {
    super(refusal.message);
    this.name = "StyleExtractionError";
    this.refusal = refusal;
  }
}

/**
 * Build a StyleProfile from a captured sample.
 *
 * The caller must pass `includeRawText: true` to authorize sending the raw
 * sample to the LLM. The prompt builder enforces this gate before any network
 * request is made.
 */
export async function buildStyleProfile(
  sample: CapturedSample,
  opts: ProfileOptions,
): Promise<StyleProfile> {
  const version = opts.promptVersion ?? "v2";
  const build = version === "v2" ? buildProfilePromptV2 : buildProfilePrompt;
  const prompt = build(sample.text, opts.constraints ?? [], {
    includeRawText: opts.includeRawText,
  });

  const registry = opts.registry ?? createLlmRegistry();

  const response = await withRetry(
    () =>
      registry.profile({
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
    throw new Error("Style profile response is not valid JSON");
  }

  /*
   * Two shapes meet here, and which one depends on which prompt was sent.
   *
   * V2 answers are validated against the strict extraction schema: every group
   * required, no defaults, and a factual-leakage check against the sample that was
   * sent. A refusal is thrown as `StyleExtractionError` so the pane can show what
   * went wrong rather than a generic provider failure.
   *
   * V1 answers are mapped by `migrateSemanticStyleFromV1` — deliberately the same
   * function the v14 state migration uses, so a profile learned from the old
   * prompt and one migrated from a v13 store reach V2 by identical rules. Two
   * implementations of "what did V1 mean" would be two answers, and they drift.
   */
  const semantic =
    version === "v2"
      ? (() => {
          const outcome = parseSemanticStyleExtraction(parsed, sample.text);
          if (!outcome.ok) throw new StyleExtractionError(outcome.refusal);
          return outcome.value;
        })()
      : migrateSemanticStyleFromV1(ProfileResponseSchema.parse(parsed));
  const measured = computeMeasuredProfile(sample.text);
  const profile = createEmptyProfile(opts.name ?? "Style profile");

  return {
    ...profile,
    measured,
    semantic,
  };
}
