/**
 * Semantic rewrite engine.
 *
 * Takes a selection the user highlighted, asks a model to restyle it to the
 * profile's learned semantic style, and turns the answer into a `Finding` the
 * planner can act on — or into an advisory finding that says why it cannot.
 *
 * It reuses `resolveAnchor` rather than a second implementation of the same
 * rule. That is the whole reason the anchor module exists: a model-supplied
 * quote has to be verified against the real document, exactly once, in one
 * place. A second, looser matcher here would be the defect the first one was
 * written to prevent.
 *
 * Boundary rule, unchanged from `deviationEngine`: this is a semantic module.
 * It may import `core/domain`, `ai/providers`, `ai/prompts`, and
 * `shared/utils`, and must not import `ui` or `word/revisionAdapter`.
 *
 * Three properties are load-bearing:
 *
 * 1. **Nothing is sent without explicit opt-in.** The prompt builder throws
 *    before any network call, so the gate cannot be bypassed by reaching for
 *    the provider directly from here.
 * 2. **A rewrite that cannot be anchored is not applied.** The model's quote is
 *    verified against the acquired nodes. Absent, ambiguous, or unaddressable
 *    yields a finding with the reason attached — never an invented offset.
 * 3. **A rewrite is a proposal, not an instruction.** Even a perfectly anchored,
 *    confidently scored rewrite is AI output about the user's own prose, so it
 *    is `source: "ai"`, medium risk, and requires approval. Being plannable is
 *    not being safe.
 */

import { v4 as uuidv4 } from "uuid";
import { RewriteResponseSchema, buildRewritePrompt } from "../ai/prompts/rewritePrompts";
import { createLlmRegistry } from "../ai/providers/registry";
import { LlmError, type LlmSemanticProvider } from "../ai/providers/LlmProvider";
import { withRetry } from "../ai/providers/retry";
import { logger } from "../shared/utils/logger";
import { FindingSchema, type Finding } from "../core/domain/Finding";
import { type DocumentNode } from "../core/domain/DocumentSnapshot";
import { resolveAnchor } from "./anchorResolution";
import { type StyleProfile } from "../core/domain/StyleProfile";

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 1000;

/**
 * Below this confidence a rewrite is advisory.
 *
 * Rewriting prose is the least mechanical thing in the product: there is no
 * mechanical check that the author's claims survived. The threshold matches the
 * deviation engine so the two surfaces answer "is this safe to apply on its
 * own?" the same way.
 */
export const REWRITE_ACTIONABLE_CONFIDENCE = 0.7;

export interface RewriteOptions {
  /** Explicit consent to send the selection to the LLM. */
  includeRawText: true;
  signal?: AbortSignal;
  registry?: LlmSemanticProvider;
}

/**
 * Ask the model to restyle `selectedText`, and verify the result is addressable.
 *
 * Returns a single finding rather than a list: one selection in, one rewrite
 * out. A caller with a list of selections calls this per selection, so a batch
 * can show partial success honestly instead of returning an array whose length
 * nobody can interpret.
 */
export async function proposeSemanticRewrite(
  selectedText: string,
  profile: StyleProfile,
  opts: RewriteOptions,
  /**
   * The acquired nodes the anchor is verified against.
   *
   * Without them no anchor can resolve, so every rewrite would be reported but
   * unaddressable. The engine is given them rather than acquiring its own so it
   * stays free of Office and testable without a host.
   */
  nodes: readonly DocumentNode[] = [],
): Promise<Finding> {
  const prompt = buildRewritePrompt(profile.semantic, selectedText, {
    includeRawText: opts.includeRawText,
  });

  const registry = opts.registry ?? createLlmRegistry();
  const response = await withRetry(
    () => registry.rewrite({ prompt, ...(opts.signal ? { signal: opts.signal } : {}) }),
    {
      maxRetries: DEFAULT_MAX_RETRIES,
      baseDelayMs: DEFAULT_BASE_DELAY_MS,
      maxDelayMs: DEFAULT_MAX_DELAY_MS,
      isRetryable: (err: unknown) => {
        // A caller-driven abort is not a failure to retry: retrying it would
        // keep a request alive that the user just cancelled.
        if (err instanceof LlmError) return err.retryable;
        return !opts.signal?.aborted;
      },
    },
  );

  const parsed = RewriteResponseSchema.safeParse(parseJson(response.text));
  if (!parsed.success) {
    // Not fatal and not a silent pass-through. A model that answered with
    // something that is not a rewrite has produced no proposal, and the user
    // needs to be told that rather than shown an empty finding.
    logger.warn("Semantic rewrite response failed validation", {
      issues: parsed.error.issues.length,
    });
    throw new Error(
      "The model did not return a usable rewrite. Nothing has been changed in the document.",
    );
  }

  const { rewritten, anchor, rationale, confidence } = parsed.data;

  /*
   * The anchor must be the whole selection.
   *
   * `rewritten` replaces the anchor, so the two have to describe the same span.
   * A model that quotes one clause and returns a rewrite of the whole paragraph
   * produces a change scoped to the clause that carries the entire paragraph as
   * its replacement — which is not what it meant and does not say what it wrote.
   * Refusing is the only safe reading.
   */
  if (anchor.trim() !== selectedText.trim()) {
    logger.warn("Semantic rewrite quoted a span other than the whole selection");
    throw new Error(
      "The model quoted only part of the selection, so the replacement could not be matched to " +
        "it. Nothing has been changed in the document.",
    );
  }

  const resolution = resolveAnchor(anchor, nodes);
  const confident = confidence >= REWRITE_ACTIONABLE_CONFIDENCE;
  const actionable = resolution.ok && confident;

  /*
   * Why this rewrite is not actionable, or null when it is.
   *
   * Stated as one reason rather than two independent fields, because the two
   * causes are not equally actionable by the user: an unresolvable anchor is a
   * dead end, while a low score is a judgement they may reasonably overrule.
   */
  let advisoryReason: string | null = null;
  if (!resolution.ok) {
    advisoryReason = resolution.reason;
  } else if (!confident) {
    advisoryReason =
      `Below ${Math.round(REWRITE_ACTIONABLE_CONFIDENCE * 100)}% confidence, so this rewrite is ` +
      "shown for you to accept rather than applied. " +
      rationale;
  }

  /*
   * `resolveAnchor` returns offsets relative to the node, so they are rebased onto
   * the node's document offset before they become a finding range. Using them
   * as-is would produce a range that points at whatever text happens to sit at
   * those offsets in the document — a range that looks valid and is not.
   */
  const base = resolution.ok
    ? (nodes.find((node) => node.nodeId === resolution.nodeId)?.sourceRange?.startOffset ?? 0)
    : 0;

  return FindingSchema.parse({
    id: uuidv4(),
    kind: "semantic",
    category: "semantic.rewrite",
    range: resolution.ok
      ? { start: base + resolution.start, end: base + resolution.end, unit: "character" }
      : { start: 0, end: 0, unit: "character" },
    message: rationale,
    severity: "info",
    evidence: anchor,
    ruleId: "semantic:rewrite",
    confidence,
    actionable,
    // Present whenever the rewrite is not actionable. Stated explicitly rather
    // than left implied, because "cannot be located" with no explanation is a
    // dead end the user cannot act on.
    ...(advisoryReason === null ? {} : { advisoryReason }),
    nodeIds: resolution.ok ? [resolution.nodeId] : [],
    source: "ai",
    // Reversible only in the sense the orchestrator verifies: Track Changes plus
    // the hash check. There is no other way back from a prose rewrite.
    reversible: true,
    // Medium regardless of the model's own confidence. A low-confidence rewrite
    // is a low risk of being *wrong about style* and a high one of changing what
    // the author meant, which is the risk that matters here.
    risk: "medium",
    status: "new",
    actual: anchor,
    expected: rewritten,
    explanation: rationale,
  });
}

/**
 * Parse model output, tolerating a fenced code block.
 *
 * Models routinely wrap JSON in ```json fences even when told not to. Rejecting
 * that would discard an otherwise valid rewrite over formatting.
 */
function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced?.[1] ?? text;
  try {
    return JSON.parse(body);
  } catch {
    // Unparseable output is "not a rewrite", not a crash. Returning a sentinel
    // lets the schema report one clear message, rather than surfacing a raw
    // SyntaxError from the engine with a character offset in it.
    return null;
  }
}
