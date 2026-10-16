/**
 * The Semantic Review engine.
 *
 * The tests are organised around the three checks that decide whether a proposal
 * may be applied, because those are the only things standing between a model's
 * prose and a user's document. Each group contains a case that must be refused
 * and, where the distinction is subtle, a neighbouring case that must not be.
 */

import { describe, expect, it, vi } from "vitest";

import { reviewSemanticSelection } from "../../../../src/analysis/semantic/semanticReviewEngine";
import {
  PROMPT_VERSION,
  buildSemanticReviewPrompt,
} from "../../../../src/analysis/semantic/reviewPrompt";
import {
  advanceSession,
  checkSessionFreshness,
  createSemanticReviewSession,
  currentSession,
  isApplicable,
} from "../../../../src/analysis/semantic/session";
import {
  reviewDomainFor,
  type SemanticReviewRequest,
} from "../../../../src/analysis/semantic/contracts";
import {
  SEMANTIC_DIMENSIONS,
  createEmptySemanticStyleProfile,
} from "../../../../src/core/domain/SemanticStyleProfile";
import { LlmError, type LlmSemanticProvider } from "../../../../src/ai/providers/LlmProvider";
import { PRESERVATION_BASE_PARAGRAPH } from "../../../fixtures/expertProse";

const NOW = "2026-01-01T00:00:00.000Z";
const PROFILE_ID = "9a2c7e14-52b8-4c3d-8e1f-2b6d4a8f0c31";
const SESSION_ID = "3f1b0c6e-6a54-4b1e-9c2a-0d1e2f3a4b5c";

const SELECTION = PRESERVATION_BASE_PARAGRAPH;

/** A faithful restyle: reordered and revoiced, nothing protected moved. */
const CLEAN_REVISION = [
  "The activity finished 42 days late, and the contemporaneous site record shows that as a matter of record.",
  "The programme of works programmed ACT-0142 for completion on 30 June 2025.",
  "Under clause 12.4.3, the Contractor (Ardmore Construction Group) notified the Employer (Meridian Civil Works Ltd) that late design information had caused the delay.",
  "The prolongation cost of £1,240,000, recorded against event EVT-0087, is recoverable in my opinion.",
  "That figure represents 4.2 % of the certified interim valuation.",
].join(" ");

function request(overrides: Partial<SemanticReviewRequest> = {}): SemanticReviewRequest {
  return {
    selectedText: SELECTION,
    selectionAnchor: {
      documentId: "doc-1",
      nodeIds: ["p1"],
      startOffset: 0,
      endOffset: SELECTION.length,
      selectedText: SELECTION,
      selectionHash: "hash-1",
      capturedAt: NOW,
    },
    profile: { id: PROFILE_ID, revision: 1 },
    semantic: createEmptySemanticStyleProfile(),
    includeRawText: true,
    domain: "constructionExpert",
    ...overrides,
  };
}

function registryReturning(payload: unknown): LlmSemanticProvider {
  const respond = async () => ({ text: JSON.stringify(payload), model: "test" });
  return {
    name: "test",
    complete: respond,
    profile: respond,
    deviations: respond,
    rewrite: respond,
    review: respond,
  };
}

function reviewBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assessment: {
      overallAlignment: "moderate",
      summary: "The paragraph is more categorical than the profile.",
      observations: [
        {
          dimension: "assertionStyle",
          alignment: "minor_deviation",
          explanation: "The conclusion is stated before the record that supports it.",
        },
      ],
    },
    proposedRevision: { original: SELECTION, revised: CLEAN_REVISION },
    meaningPreservation: {
      qualificationPreserved: true,
      attributionPreserved: true,
      causationPreserved: true,
      responsibilityPreserved: true,
      certaintyPreserved: true,
    },
    rationale: "Reorders the clauses so the record precedes the conclusion.",
    ...overrides,
  };
}

describe("buildSemanticReviewPrompt", () => {
  it("refuses to build without explicit raw-text consent", () => {
    expect(() => buildSemanticReviewPrompt(request())).toThrow(/includeRawText: true/);
  });

  it("carries the selection and the profile into the prompt", () => {
    const prompt = buildSemanticReviewPrompt(request(), { includeRawText: true });
    expect(prompt).toContain(SELECTION);
    expect(prompt).toContain("Active style profile");
  });

  it("tells the model to copy the selection exactly and to report the meaning flags", () => {
    const prompt = buildSemanticReviewPrompt(request(), { includeRawText: true });
    expect(prompt).toMatch(/character for character/);
    expect(prompt).toMatch(/causationPreserved/);
  });

  it("frames the review in terms of the corpus the profile was learned from", () => {
    const expert = buildSemanticReviewPrompt(request(), { includeRawText: true });
    const general = buildSemanticReviewPrompt(request({ domain: "general" }), {
      includeRawText: true,
    });
    expect(expert).not.toBe(general);
    expect(general).toMatch(/general business writing/);
  });

  it("names every dimension, so the model picks one rather than inventing one", () => {
    // The schema rejects an unknown dimension outright, so a prompt that names
    // only the keys produces a refusal instead of a review.
    const prompt = buildSemanticReviewPrompt(request(), { includeRawText: true });
    SEMANTIC_DIMENSIONS.forEach((dimension) => {
      expect(prompt).toContain(dimension);
    });
  });

  it("states the enum values the schema enforces, not just the key names", () => {
    const prompt = buildSemanticReviewPrompt(request(), { includeRawText: true });
    expect(prompt).toContain("minor_deviation");
    expect(prompt).toContain("material_deviation");
    expect(prompt).toContain("moderate");
  });

  it("stamps the prompt version, so a stale review can be detected", () => {
    const prompt = buildSemanticReviewPrompt(request(), { includeRawText: true });
    expect(prompt).toContain(`prompt-version: ${PROMPT_VERSION}`);
  });
});

describe("reviewDomainFor", () => {
  it("frames an expert-register profile as expert reporting", () => {
    const semantic = createEmptySemanticStyleProfile();
    semantic.register.primary = "expert";
    expect(reviewDomainFor(semantic)).toBe("constructionExpert");
  });

  it("frames every other register as general business writing", () => {
    expect(reviewDomainFor(createEmptySemanticStyleProfile())).toBe("general");
  });
});

describe("reviewSemanticSelection", () => {
  it("returns an assessment and a proposal from one call", async () => {
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registryReturning(reviewBody()),
      newSessionId: () => SESSION_ID,
    });

    expect(result.assessment.overallAlignment).toBe("moderate");
    expect(result.proposedRevision).toBe(CLEAN_REVISION);
    expect(result.reviewSessionId).toBe(SESSION_ID);
    expect(result.providerMetadata).toMatchObject({ provider: "test", model: "test", attempt: 1 });
  });

  it("carries the model's own rationale, so the change cites what it said it did", async () => {
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registryReturning(reviewBody()),
    });
    expect(result.rationale).toBe("Reorders the clauses so the record precedes the conclusion.");
  });

  it("records the run id and a duration for every stage that ran", async () => {
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registryReturning(reviewBody()),
      runId: "run-fixed",
    });

    expect(result.runId).toBe("run-fixed");
    // Every stage that began is present; a stage that never ran is absent rather
    // than zero, which is what makes the timings readable as "what happened".
    expect(Object.keys(result.stageTimings).sort()).toEqual([
      "preservation_check",
      "prompt_build",
      "provider_call",
      "response_parse",
    ]);
  });

  it("accepts a dimension the model wrote in the wrong case", async () => {
    // "Tone" fails the enum outright, and a whole response refused over a capital
    // letter is a refusal the user cannot act on.
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registryReturning(
        reviewBody({
          assessment: {
            overallAlignment: "moderate",
            summary: "Reads close to the profile.",
            observations: [
              { dimension: "Tone", alignment: "aligned", explanation: "Reads as neutral." },
            ],
          },
        }),
      ),
    });
    expect(result.assessment.observations[0]?.dimension).toBe("tone");
  });

  it("coerces shorthand alignment to the value the schema enforces", async () => {
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registryReturning(
        reviewBody({
          assessment: {
            overallAlignment: "moderate",
            summary: "More categorical than the profile.",
            observations: [
              { dimension: "tone", alignment: "minor", explanation: "Nearly aligned." },
            ],
          },
        }),
      ),
    });
    expect(result.assessment.observations[0]?.alignment).toBe("minor_deviation");
  });

  it("reads a medium overall alignment as moderate", async () => {
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registryReturning(
        reviewBody({
          assessment: {
            overallAlignment: "medium",
            summary: "Partly aligned.",
            observations: [{ dimension: "tone", alignment: "aligned", explanation: "Aligned." }],
          },
        }),
      ),
    });
    expect(result.assessment.overallAlignment).toBe("moderate");
  });

  it("assumes the meaning flags are preserved when the model states none", async () => {
    // An omitted flag is not a claim that the meaning was lost, and refusing the
    // review over the absence is a dead end rather than a caution.
    const body = reviewBody();
    delete body.meaningPreservation;
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registryReturning(body),
    });
    expect(result.meaningPreservation).toEqual({
      qualificationPreserved: true,
      attributionPreserved: true,
      causationPreserved: true,
      responsibilityPreserved: true,
      certaintyPreserved: true,
    });
    expect(result.actionable).toBe(true);
  });

  it("substitutes one observation when the model names none", async () => {
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registryReturning(
        reviewBody({
          assessment: {
            overallAlignment: "high",
            summary: "Close to the profile.",
            observations: [],
          },
        }),
      ),
    });
    expect(result.assessment.observations).toHaveLength(1);
    expect(result.assessment.observations[0]?.dimension).toBe("tone");
  });

  it("falls back to the summary when the model states no rationale", async () => {
    const body = reviewBody();
    delete body.rationale;
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registryReturning(body),
    });
    expect(result.rationale).toBe("The paragraph is more categorical than the profile.");
  });

  it("marks a faithful restyle actionable", async () => {
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registryReturning(reviewBody()),
    });
    expect(result.actionable).toBe(true);
    expect(result.preservation.pass).toBe(true);
    expect(result.refusalReason).toBeUndefined();
  });

  it("refuses a revision that moved a date, whatever the model reported", async () => {
    const moved = SELECTION.replace("30 June 2025", "18 July 2025");
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registryReturning(
        reviewBody({ proposedRevision: { original: SELECTION, revised: moved } }),
      ),
    });

    expect(result.actionable).toBe(false);
    expect(result.preservation.pass).toBe(false);
    expect(result.preservation.changed.map((c) => c.from.surface)).toContain("30 June 2025");
    expect(result.refusalReason).toMatch(/factual difference/i);
  });

  it("refuses when the model says it may have reversed a causation", async () => {
    /*
     * The case the local validator cannot catch. Every figure survives, every
     * clause reference survives, and the claim has changed.
     */
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registryReturning(
        reviewBody({
          meaningPreservation: {
            qualificationPreserved: true,
            attributionPreserved: true,
            causationPreserved: false,
            responsibilityPreserved: true,
            certaintyPreserved: true,
          },
        }),
      ),
    });

    expect(result.preservation.pass).toBe(true);
    expect(result.actionable).toBe(false);
    expect(result.refusalReason).toContain("causation");
  });

  it("refuses a revision the model did not scope to the selection", async () => {
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registryReturning(
        reviewBody({
          proposedRevision: {
            original: "the first sentence only",
            revised: "a completely different sentence",
          },
        }),
      ),
    });

    expect(result.actionable).toBe(false);
    expect(result.refusalReason).toMatch(/did not match the selected text/i);
  });

  it("treats no proposal as an answer, not a failure", async () => {
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registryReturning(reviewBody({ proposedRevision: undefined })),
    });

    expect(result.proposedRevision).toBeUndefined();
    expect(result.actionable).toBe(false);
    expect(result.refusalReason).toMatch(/found no change/i);
  });

  it("throws rather than returning an empty assessment on a malformed answer", async () => {
    await expect(
      reviewSemanticSelection(request(), {
        includeRawText: true,
        registry: registryReturning({ assessment: "looks fine to me" }),
      }),
    ).rejects.toThrow(/did not return a usable semantic review/i);
  });

  it("accepts a fenced JSON response, which models emit despite instructions", async () => {
    const fenced = { ...registryReturning(reviewBody()) };
    const respond = async () => ({
      text: "```json\n" + JSON.stringify(reviewBody()) + "\n```",
      model: "test",
    });
    const registry = { ...fenced, complete: respond, review: respond };
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registry as LlmSemanticProvider,
    });
    expect(result.actionable).toBe(true);
  });

  it("makes one provider call, because the adapter owns retrying", async () => {
    // Two retry layers multiplied: three engine attempts across three adapter
    // attempts is nine requests for one user action, and the outer layer only
    // delayed the failure the user was already waiting for.
    const review = vi.fn().mockRejectedValue(new LlmError("rate limited", "test", true));
    const registry = {
      name: "test",
      complete: review,
      profile: review,
      deviations: review,
      rewrite: review,
      review,
    } as LlmSemanticProvider;

    await expect(
      reviewSemanticSelection(request(), { includeRawText: true, registry }),
    ).rejects.toThrow(/rate limited/);
    expect(review).toHaveBeenCalledTimes(1);
  });

  it("reports the attempt count the adapter made", async () => {
    const respond = async () => ({ text: JSON.stringify(reviewBody()), model: "test", attempt: 3 });
    const registry = {
      name: "test",
      complete: respond,
      profile: respond,
      deviations: respond,
      rewrite: respond,
      review: respond,
    } as LlmSemanticProvider;

    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry,
    });
    expect(result.providerMetadata.attempt).toBe(3);
  });

  it("reads a JSON object the model wrapped in prose", async () => {
    const respond = async () => ({
      text: `Here is the review:\n${JSON.stringify(reviewBody())}\nI hope that helps.`,
      model: "test",
    });
    const registry = {
      name: "test",
      complete: respond,
      profile: respond,
      deviations: respond,
      rewrite: respond,
      review: respond,
    } as LlmSemanticProvider;

    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry,
    });
    expect(result.actionable).toBe(true);
  });

  it("asks once more when the answer cannot be read, and uses the repair", async () => {
    const review = vi
      .fn()
      .mockResolvedValueOnce({ text: "I am unable to comply.", model: "test" })
      .mockResolvedValue({ text: JSON.stringify(reviewBody()), model: "test" });
    const registry = {
      name: "test",
      complete: review,
      profile: review,
      deviations: review,
      rewrite: review,
      review,
    } as LlmSemanticProvider;

    const result = await reviewSemanticSelection(request(), { includeRawText: true, registry });

    expect(result.actionable).toBe(true);
    expect(review).toHaveBeenCalledTimes(2);
    // Both calls this request cost, so the count stays a measurement.
    expect(result.providerMetadata.attempt).toBe(2);
  });

  it("gives up after one repair rather than asking again and again", async () => {
    const review = vi.fn().mockResolvedValue({ text: "still not JSON", model: "test" });
    const registry = {
      name: "test",
      complete: review,
      profile: review,
      deviations: review,
      rewrite: review,
      review,
    } as LlmSemanticProvider;

    await expect(
      reviewSemanticSelection(request(), { includeRawText: true, registry }),
    ).rejects.toThrow(/did not return a usable semantic review/i);
    expect(review).toHaveBeenCalledTimes(2);
  });

  it("treats a caller abort as non-retryable", async () => {
    const controller = new AbortController();
    controller.abort();
    const review = vi.fn().mockRejectedValue(new LlmError("cancelled", "test", true));
    const registry = {
      name: "test",
      complete: review,
      profile: review,
      deviations: review,
      rewrite: review,
      review,
    } as LlmSemanticProvider;

    await expect(
      reviewSemanticSelection(request(), {
        includeRawText: true,
        registry,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    // Retrying a request the user just cancelled would keep it alive.
    expect(review).toHaveBeenCalledTimes(1);
  });

  it("warns rather than refusing when it cannot classify what changed", async () => {
    const hedged = SELECTION.replace("is recoverable in my opinion", "is probably recoverable");
    const result = await reviewSemanticSelection(request(), {
      includeRawText: true,
      registry: registryReturning(
        reviewBody({ proposedRevision: { original: SELECTION, revised: hedged } }),
      ),
    });

    // The check ran, said what it could not verify, and left the decision to the
    // user. A hard failure here would fire on most legitimate restyles.
    expect(result.preservation.pass).toBe(true);
    expect(result.preservation.requiresAcknowledgement).toBe(true);
    expect(result.refusalReason).toMatch(/Review carefully/i);
  });
});

describe("the semantic review session", () => {
  const context = { selectionHash: "hash-1", profileId: PROFILE_ID, profileRevision: 1 };

  function session() {
    return createSemanticReviewSession(
      context,
      {
        documentId: "doc-1",
        nodeIds: ["p1"],
        startOffset: 0,
        endOffset: 10,
        selectedText: SELECTION,
        selectionHash: "hash-1",
        capturedAt: NOW,
      },
      { provider: "test", model: "test" },
      NOW,
      SESSION_ID,
    );
  }

  it("starts ready and not applicable", () => {
    expect(session().state).toBe("ready");
    expect(isApplicable(session())).toBe(false);
  });

  it("is applicable only once a proposal exists", () => {
    expect(isApplicable(advanceSession(session(), "proposed", NOW))).toBe(true);
    expect(isApplicable(advanceSession(session(), "kept_original", NOW))).toBe(false);
  });

  it("goes stale when the selection changed, and says so", () => {
    const result = checkSessionFreshness(session(), { ...context, selectionHash: "hash-2" });
    expect(result.fresh).toBe(false);
    if (result.fresh) return;
    expect(result.reason).toMatch(/selection has changed/i);
  });

  it("goes stale when the profile moved on, and says so", () => {
    const result = checkSessionFreshness(session(), { ...context, profileRevision: 2 });
    expect(result.fresh).toBe(false);
    if (result.fresh) return;
    expect(result.reason).toMatch(/profile has changed/i);
  });

  it("is fresh while nothing has moved", () => {
    expect(checkSessionFreshness(session(), context).fresh).toBe(true);
  });

  it("applies staleness to the session the pane renders, not beside it", () => {
    // One value, not a flag beside it: a caller cannot show a proposal it forgot
    // to check.
    const stale = currentSession(session(), { ...context, selectionHash: "hash-2" }, NOW);
    expect(stale.state).toBe("stale");
    expect(stale.completedAt).toBe(NOW);
    expect(isApplicable(stale)).toBe(false);
  });

  it("leaves a fresh session untouched", () => {
    expect(currentSession(session(), context, NOW).state).toBe("ready");
  });

  it("stamps a completion time once and does not move it", () => {
    const proposed = advanceSession(session(), "proposed", NOW);
    const applied = advanceSession(proposed, "applied", "2026-02-01T00:00:00.000Z");
    const again = advanceSession(applied, "applied", "2026-03-01T00:00:00.000Z");
    expect(again.completedAt).toBe("2026-02-01T00:00:00.000Z");
  });
});
