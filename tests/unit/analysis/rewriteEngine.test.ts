import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  REWRITE_ACTIONABLE_CONFIDENCE,
  proposeSemanticRewrite,
} from "../../../src/analysis/rewriteEngine";
import { createEmptyProfile, type StyleProfile } from "../../../src/core/domain/StyleProfile";
import type { DocumentNode } from "../../../src/core/domain/DocumentSnapshot";

const SELECTION = "Onboarding takes about two weeks to complete.";

const NODE: DocumentNode = {
  nodeId: "n1",
  type: "paragraph",
  text: SELECTION,
  sourceRange: { startOffset: 100 },
} as unknown as DocumentNode;

function profile(): StyleProfile {
  return {
    ...createEmptyProfile("House", 1),
    semantic: {
      tone: "neutral",
      voice: "third-person",
      formality: 50,
      readingGradeTarget: null,
      preferredSentenceLength: 20,
      vocabularyRegister: "standard",
      rhetoricalStyle: "direct",
      avoidWords: [],
    },
  };
}

const goodBody = {
  rewritten: "Onboarding takes roughly two weeks.",
  anchor: "Onboarding takes about two weeks to complete.",
  rationale: "Replaces one word; the claim is unchanged.",
  confidence: 0.86,
};

function registry(text: string) {
  return { name: "mock", rewrite: vi.fn(async () => ({ text })) } as never;
}

describe("proposeSemanticRewrite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses without explicit raw-text consent, before any provider call", async () => {
    const reg = registry(JSON.stringify(goodBody));
    await expect(
      proposeSemanticRewrite(SELECTION, profile(), { includeRawText: false as never }, [NODE]),
    ).rejects.toThrow(/includeRawText: true/);
    expect(
      (reg as unknown as { rewrite: ReturnType<typeof vi.fn> }).rewrite,
    ).not.toHaveBeenCalled();
  });

  it("anchors a confident rewrite to a real span and makes it actionable", async () => {
    const finding = await proposeSemanticRewrite(
      SELECTION,
      profile(),
      { includeRawText: true, registry: registry(JSON.stringify(goodBody)) },
      [NODE],
    );

    expect(finding.actionable).toBe(true);
    /*
     * Document-absolute, not node-relative. The selection starts at 0 inside
     * the node and the node begins at 100, so a range of 0..46 would point at
     * whatever text happens to sit there — a valid-looking range that is wrong.
     */
    expect(finding.range).toMatchObject({ start: 100, end: 145, unit: "character" });
    expect(finding.nodeIds).toEqual(["n1"]);
    // The precondition the planner needs: exact old text, exact new text.
    expect(finding.actual).toBe(SELECTION);
    expect(finding.expected).toBe(goodBody.rewritten);
  });

  it("refuses a rewrite that quoted only part of the selection", async () => {
    /*
     * `rewritten` replaces the anchor, so a partial anchor makes the change say
     * something the model did not write: the edit would be scoped to the clause
     * and carry the whole paragraph as its replacement.
     */
    await expect(
      proposeSemanticRewrite(
        SELECTION,
        profile(),
        {
          includeRawText: true,
          registry: registry(JSON.stringify({ ...goodBody, anchor: "about two weeks" })),
        },
        [NODE],
      ),
    ).rejects.toThrow(/quoted only part of the selection/);
  });

  it("marks an unanchored rewrite advisory and says why, never inventing an offset", async () => {
    /*
     * The model quoted the selection correctly, but the document no longer
     * contains it — the paragraph was edited between the request and the reply.
     * The finding is still produced, because the report of a conflict is worth
     * making; it just cannot become a change.
     */
    const moved: DocumentNode = {
      ...(NODE as unknown as Record<string, unknown>),
      text: "Something else entirely.",
    } as unknown as DocumentNode;

    const finding = await proposeSemanticRewrite(
      SELECTION,
      profile(),
      { includeRawText: true, registry: registry(JSON.stringify(goodBody)) },
      [moved],
    );

    expect(finding.actionable).toBe(false);
    expect(finding.advisoryReason).toMatch(/does not appear in the document/i);
    expect(finding.nodeIds).toEqual([]);
  });

  it("refuses an ambiguous anchor rather than guessing between two spans", async () => {
    const doubled: DocumentNode = {
      ...(NODE as unknown as Record<string, unknown>),
      text: `${SELECTION} ${SELECTION}`,
    } as unknown as DocumentNode;

    const finding = await proposeSemanticRewrite(
      SELECTION,
      profile(),
      { includeRawText: true, registry: registry(JSON.stringify(goodBody)) },
      [doubled],
    );

    expect(finding.actionable).toBe(false);
    expect(finding.advisoryReason).toMatch(/appears 2 times/i);
  });

  it("keeps a low-confidence rewrite advisory with the model's own reason attached", async () => {
    const finding = await proposeSemanticRewrite(
      SELECTION,
      profile(),
      {
        includeRawText: true,
        registry: registry(
          JSON.stringify({ ...goodBody, confidence: REWRITE_ACTIONABLE_CONFIDENCE - 0.1 }),
        ),
      },
      [NODE],
    );

    expect(finding.actionable).toBe(false);
    // The reason is stated, not merely that it is low: the user can judge a
    // judgement, but not a bare number. It must also not offer an acceptance
    // the review gate cannot honour — `actionable: false` means no pending
    // change is ever created for this finding.
    expect(finding.advisoryReason).toMatch(
      /shown for reference only and cannot be sent for review/,
    );
    expect(finding.advisoryReason).toContain(goodBody.rationale);
  });

  it("treats an anchored rewrite as AI-sourced and medium risk whatever the score", async () => {
    const finding = await proposeSemanticRewrite(
      SELECTION,
      profile(),
      {
        includeRawText: true,
        registry: registry(JSON.stringify({ ...goodBody, confidence: 0.99 })),
      },
      [NODE],
    );

    expect(finding.source).toBe("ai");
    expect(finding.risk).toBe("medium");
    expect(finding.status).toBe("new");
  });

  it("throws on a response that is not a rewrite, rather than returning an empty one", async () => {
    await expect(
      proposeSemanticRewrite(
        SELECTION,
        profile(),
        { includeRawText: true, registry: registry("not json at all") },
        [NODE],
      ),
    ).rejects.toThrow(/did not return a usable rewrite/);
  });

  it("rejects a rewrite with no anchor", async () => {
    await expect(
      proposeSemanticRewrite(
        SELECTION,
        profile(),
        {
          includeRawText: true,
          registry: registry(JSON.stringify({ ...goodBody, anchor: "" })),
        },
        [NODE],
      ),
    ).rejects.toThrow(/did not return a usable rewrite/);
  });

  it("accepts a fenced JSON response, which models emit despite instructions", async () => {
    const finding = await proposeSemanticRewrite(
      SELECTION,
      profile(),
      {
        includeRawText: true,
        registry: registry("```json\n" + JSON.stringify(goodBody) + "\n```"),
      },
      [NODE],
    );

    expect(finding.actionable).toBe(true);
  });

  it("treats a caller abort as non-retryable", async () => {
    const controller = new AbortController();
    controller.abort();
    const rewrite = vi.fn(async () => {
      throw new Error("aborted");
    });

    await expect(
      proposeSemanticRewrite(
        SELECTION,
        profile(),
        {
          includeRawText: true,
          signal: controller.signal,
          registry: { name: "mock", rewrite } as never,
        },
        [NODE],
      ),
    ).rejects.toThrow();
    // One attempt, not the retry budget: retrying a cancelled request keeps
    // work alive that the user just stopped.
    expect(rewrite).toHaveBeenCalledTimes(1);
  });
});
