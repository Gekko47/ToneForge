/**
 * Characterisation of the semantic rewrite as it exists today.
 *
 * Plan P0.3. The plan deletes `rewriteEngine.ts` and `semanticApply.ts`'s
 * `Finding`-shaped input in P4 and P6. Deleting an engine is safe only if the
 * behaviour it is replaced by is provably a superset, and the only way to have
 * that proof is to record what the current engine does *before* it goes.
 *
 * So this file asserts the current behaviour rather than the desired behaviour,
 * and it is expected to be deleted in P6 alongside the code it describes. The
 * cases are deliberately unflattering: where today's product would write a wrong
 * date into an expert report, this file says so in a test name rather than
 * leaving it as a gap somebody has to rediscover.
 *
 * **This is a snapshot of a defect, not an endorsement.** The assertions under
 * "no local factual protection" are true today and become false in P3/P6. When
 * they are inverted, this file is removed and the replacement is
 * `tests/unit/analysis/semantic/preservationValidator.test.ts`.
 *
 * The prose is the synthetic expert corpus, not a toy sentence, because the
 * defect only exists on text that carries facts worth protecting.
 */

import { describe, expect, it, vi } from "vitest";
import {
  REWRITE_ACTIONABLE_CONFIDENCE,
  proposeSemanticRewrite,
} from "../../../src/analysis/rewriteEngine";
import { buildSemanticRewriteChange } from "../../../src/reformat/semanticApply";
import { createEmptyProfile, type StyleProfile } from "../../../src/core/domain/StyleProfile";
import { createEmptySemanticStyleProfile } from "../../../src/core/domain/SemanticStyleProfile";
import type { DocumentNode } from "../../../src/core/domain/DocumentSnapshot";
import { PRESERVATION_BASE_PARAGRAPH } from "../../fixtures/expertProse";

const SEMANTIC = createEmptySemanticStyleProfile();

const SELECTION = PRESERVATION_BASE_PARAGRAPH;
const NODE_START = 4_100;

/** A node whose text is the whole selection, positioned in a longer document. */
const NODE = {
  nodeId: "expert-para-7",
  type: "paragraph",
  text: SELECTION,
  sourceRange: { startOffset: NODE_START },
} as unknown as DocumentNode;

function profile(): StyleProfile {
  return {
    ...createEmptyProfile("Expert report", 1, "semantic"),
    semantic: {
      ...SEMANTIC,
      tone: { ...SEMANTIC.tone, primary: "restrained" },
      voice: { ...SEMANTIC.voice, person: "third" },
      formality: { score: 70, label: "" },
      register: { primary: "expert", description: "" },
      sentenceArchitecture: { ...SEMANTIC.sentenceArchitecture, targetWords: 24 },
    },
  };
}

/** A registry that answers every helper with one scripted body. */
function scriptedRegistry(text: string) {
  const response = async () => ({ text, model: "mock" });
  return {
    name: "mock",
    complete: vi.fn(response),
    profile: vi.fn(response),
    deviations: vi.fn(response),
    rewrite: vi.fn(response),
    review: vi.fn(response),
  };
}

/**
 * The prompt the engine actually sent.
 *
 * Read through the spy rather than through a return value, because the point is
 * what left the add-in. Throws rather than defaulting to an empty string: an
 * empty prompt would make the containment assertions below pass for the wrong
 * reason, which is the failure this helper exists to prevent.
 */
function capturedPrompt(registry: ReturnType<typeof scriptedRegistry>): string {
  const call = registry.rewrite.mock.calls[0] as unknown;
  if (Array.isArray(call) === false || call.length === 0) {
    throw new Error("The engine did not send a request, so there is no prompt to inspect.");
  }
  const [request] = call as [{ prompt: string }];
  return request.prompt;
}

/** The model's own JSON, with the anchor pinned to the whole selection. */
function body(rewritten: string, confidence: number) {
  return JSON.stringify({
    rewritten,
    anchor: SELECTION,
    rationale: "Matches the requested register.",
    confidence,
  });
}

describe("today's semantic rewrite, characterised before it is replaced", () => {
  it("declines a low-confidence rewrite on confidence alone", async () => {
    /*
     * The only quality gate the engine has.
     *
     * Pinned because P6 removes `REWRITE_ACTIONABLE_CONFIDENCE` entirely. The
     * threshold itself is not a safety property worth keeping — a model's own
     * score is not evidence that facts survived — but its *role* as the only
     * gate is the thing the plan replaces.
     */
    expect(REWRITE_ACTIONABLE_CONFIDENCE).toBe(0.7);

    const finding = await proposeSemanticRewrite(
      SELECTION,
      profile(),
      {
        includeRawText: true,
        registry: scriptedRegistry(body("A shorter restatement.", 0.69)),
      },
      [NODE],
    );

    expect(finding.actionable).toBe(false);
    expect(finding.advisoryReason).toMatch(/below 70%/i);
  });

  it("accepts a full-confidence rewrite that moves a date, a figure, and causation", async () => {
    /*
     * The defect, stated as an assertion.
     *
     * One response alters a date, a currency sum, and the direction of causation,
     * and the engine reports it as actionable with maximum confidence. Nothing
     * between the model's JSON and the user's Apply button inspects whether a
     * protected token moved, because as of this commit no such check exists
     * anywhere in the repository.
     */
    const rewritten = SELECTION.replace("30 June 2025", "18 July 2025")
      .replace("£1,240,000", "£1,940,000")
      .replace("caused by late design information", "caused by late resourcing on site");

    const finding = await proposeSemanticRewrite(
      SELECTION,
      profile(),
      {
        includeRawText: true,
        registry: scriptedRegistry(body(rewritten, 1)),
      },
      [NODE],
    );

    expect(finding.actionable).toBe(true);
    expect(finding.risk).toBe("medium");
    expect(finding.source).toBe("ai");

    // And the change the apply path would build carries all three alterations,
    // with the approval already satisfied because the user pressed the button.
    const change = buildSemanticRewriteChange(finding);
    expect(change.payload["text"]).toContain("18 July 2025");
    expect(change.payload["text"]).toContain("£1,940,000");
    expect(change.payload["text"]).toContain("late resourcing on site");
    expect(change.approvalState).toBe("approved");
  });

  it("carries the original text as the precondition, so the target is still protected", async () => {
    /*
     * The one protection that does exist, and the one P6 must not lose.
     *
     * Even when the *content* of a proposal is wrong, the write cannot land on
     * the wrong span: the exact original text is the precondition, and the
     * adapter refuses the plan if the document has moved. P6 keeps this
     * behaviour and adds the content checks on top of it.
     */
    const finding = await proposeSemanticRewrite(
      SELECTION,
      profile(),
      {
        includeRawText: true,
        registry: scriptedRegistry(body(SELECTION.replace("42 days", "24 days"), 0.95)),
      },
      [NODE],
    );

    const change = buildSemanticRewriteChange(finding);
    expect(change.precondition).toEqual({ kind: "text", expectedText: SELECTION });
    expect(change.range).toMatchObject({ start: NODE_START, end: NODE_START + SELECTION.length });
    expect(change.range.target).toEqual({
      kind: "paragraph",
      index: 0,
      nodeId: "expert-para-7",
    });
  });

  it("refuses a rewrite whose anchor covers only part of the selection", async () => {
    /*
     * Pinned because the new contract removes the model's anchor entirely.
     *
     * Today's engine cannot use a model-chosen target at all: the quote must be
     * the entire selection or the whole call is refused. The replacement is
     * stricter still — the target is captured locally before the call — so this
     * case exists to show the direction of travel rather than to be preserved.
     */
    const partial = JSON.stringify({
      rewritten: "Activity ACT-0142 was programmed to complete on 30 June 2025.",
      anchor: "Activity ACT-0142 was programmed to complete on 30 June 2025.",
      rationale: "Rewrites the first sentence only.",
      confidence: 0.99,
    });

    await expect(
      proposeSemanticRewrite(
        SELECTION,
        profile(),
        { includeRawText: true, registry: scriptedRegistry(partial) },
        [NODE],
      ),
    ).rejects.toThrow(/quoted only part of the selection/i);
  });

  it("sends the selection and the semantic profile, and nothing else", async () => {
    /*
     * The privacy property the plan keeps and re-asserts in P4.
     *
     * The prompt body is captured here so the replacement engine can be held to
     * the same standard: a request that carries a selection is a document
     * leaving the machine, so the contents of the request are the thing under
     * test, not merely the fact that a call happened.
     */
    const registry = scriptedRegistry(body(SELECTION, 0.9));
    await proposeSemanticRewrite(SELECTION, profile(), { includeRawText: true, registry }, [NODE]);

    const prompt = capturedPrompt(registry);
    expect(prompt).toContain(SELECTION);
    // The profile is sent as JSON, so the model reads the same values the pane
    // displays rather than a prose summary of them. `JSON.stringify` emits no
    // whitespace after the separators, which is what the engine passes through.
    expect(prompt).toContain('"primary":"restrained"');
    expect(prompt).toContain('"score":70');
    expect(prompt).toContain('"register":{"primary":"expert"');
    // The engine is handed the acquired nodes so it can verify the anchor, but
    // only the selection reaches the prompt: the surrounding document does not.
    expect(prompt).not.toContain("nodeId");
    expect(prompt).not.toContain("sourceRange");
  });
});
