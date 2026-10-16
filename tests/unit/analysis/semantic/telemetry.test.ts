/**
 * Semantic review telemetry.
 *
 * The property that matters is a negative one: an event must carry identifiers,
 * counts and sizes and **no document text**. Telemetry is the easiest place in an
 * application to leak a document by accident, because it is written by the code
 * that already has the text in hand — so the digest is asserted field by field
 * rather than by eyeballing the type.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "../../../../src/shared/utils/logger";
import {
  buildPromptDigest,
  buildResponseDigest,
  emitTelemetry,
} from "../../../../src/analysis/semantic/telemetry";

describe("the prompt digest", () => {
  it("reports the size and the identity, and not the prompt", () => {
    const prompt = "Review this: the Contractor notified the Employer on 30 June 2025.";
    const digest = buildPromptDigest({
      promptVersion: 1,
      prompt,
      profileId: "profile-1",
      profileRevision: 4,
      domain: "constructionExpert",
      selectionChars: 62,
    });

    expect(digest.promptLength).toBe(prompt.length);
    expect(digest).toMatchObject({
      promptVersion: 1,
      profileId: "profile-1",
      profileRevision: 4,
      domain: "constructionExpert",
      selectionChars: 62,
    });
    // The whole point: the document's words are not in the serialised digest.
    expect(JSON.stringify(digest)).not.toContain("Contractor");
    expect(JSON.stringify(digest)).not.toContain("30 June 2025");
  });
});

describe("the response digest", () => {
  it("reports what happened to the answer, and not the answer", () => {
    const digest = buildResponseDigest({
      responseText: "Not JSON at all, unfortunately.",
      parsedSuccessfully: false,
      repairStepsApplied: ["fence-strip", "repair-prompt"],
      zodIssueCount: 3,
    });

    expect(digest.responseLength).toBe("Not JSON at all, unfortunately.".length);
    expect(digest.parsedSuccessfully).toBe(false);
    expect(digest.repairStepsApplied).toEqual(["fence-strip", "repair-prompt"]);
    expect(digest.zodIssueCount).toBe(3);
    expect(JSON.stringify(digest)).not.toContain("unfortunately");
  });

  it("copies the repair steps rather than holding the caller's array", () => {
    const steps = ["repair-prompt"];
    const digest = buildResponseDigest({
      responseText: "{}",
      parsedSuccessfully: true,
      repairStepsApplied: steps,
      zodIssueCount: 0,
    });
    steps.push("added-later");
    expect(digest.repairStepsApplied).toEqual(["repair-prompt"]);
  });
});

describe("emitTelemetry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records the event through the shared logger, with no endpoint in between", () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    emitTelemetry({
      event: "review.completed",
      runId: "run-1",
      actionable: true,
      hasProposal: true,
      preservationPassed: true,
      totalDurationMs: 1500,
      attempt: 1,
    });

    expect(info).toHaveBeenCalledTimes(1);
    const [message, context] = info.mock.calls[0] ?? [];
    expect(String(message)).toContain("review.completed");
    expect(context).toMatchObject({ runId: "run-1", attempt: 1 });
  });
});
