import { describe, expect, it } from "vitest";
import { deriveAnnouncement, type AnnouncementInput } from "../../../../src/taskpane/state/announcement";

/**
 * The priority order is the whole point of this module.
 *
 * Three sources can settle in the same tick — the document observer finishing a
 * scan, the apply path refusing a plan, and the consistency review reporting a
 * blocker — and before this existed each rendered its own live region. These
 * cases pin which one speaks, because "the wrong thing is announced" is
 * indistinguishable from "nothing is announced" to a screen reader user.
 */

function state(overrides: Partial<AnnouncementInput> = {}): AnnouncementInput {
  return {
    scanPhase: "notStarted",
    findingCount: 0,
    error: null,
    applyMessage: null,
    reviewMessage: null,
    hostUnavailable: false,
    ...overrides,
  };
}

describe("deriveAnnouncement", () => {
  it("says nothing before anything has happened", () => {
    expect(deriveAnnouncement(state())).toBeNull();
  });

  it("announces a completed scan with its finding count", () => {
    expect(deriveAnnouncement(state({ scanPhase: "fresh", findingCount: 3 }))).toBe(
      "Scan complete. 3 findings.",
    );
  });

  it("uses the singular for one finding rather than '1 findings'", () => {
    expect(deriveAnnouncement(state({ scanPhase: "fresh", findingCount: 1 }))).toBe(
      "Scan complete. 1 finding.",
    );
  });

  it("distinguishes a clean document from a scan that found nothing to say", () => {
    expect(deriveAnnouncement(state({ scanPhase: "clean", findingCount: 0 }))).toBe(
      "Scan complete. No findings.",
    );
  });

  it("announces a scan in progress", () => {
    expect(deriveAnnouncement(state({ scanPhase: "scanning" }))).toBe("Scanning the document.");
  });

  it("puts an error ahead of everything else", () => {
    const sentence = deriveAnnouncement(
      state({
        error: "the host refused the read",
        applyMessage: "Applied and verified 2 change(s).",
        reviewMessage: "Consent is required.",
        scanPhase: "fresh",
        findingCount: 2,
      }),
    );
    expect(sentence).toBe("Scan failed: the host refused the read");
  });

  it("puts an apply result ahead of a background scan", () => {
    const sentence = deriveAnnouncement(
      state({ applyMessage: "Applied and verified 2 change(s).", scanPhase: "fresh", findingCount: 2 }),
    );
    expect(sentence).toBe("Applied and verified 2 change(s).");
  });

  it("puts a review blocker ahead of a background scan", () => {
    const sentence = deriveAnnouncement(
      state({ reviewMessage: "Consent is required.", scanPhase: "fresh", findingCount: 2 }),
    );
    expect(sentence).toBe("Consent is required.");
  });

  it("prefers a review blocker over an apply result, because the review is what the user is looking at", () => {
    const sentence = deriveAnnouncement(
      state({
        applyMessage: "Applied and verified 2 change(s).",
        reviewMessage: "Consent is required.",
      }),
    );
    expect(sentence).toBe("Consent is required.");
  });

  it("puts an unreachable host ahead of a stale message, because nothing else can be true", () => {
    const sentence = deriveAnnouncement(
      state({ hostUnavailable: true, applyMessage: "Applied and verified 2 change(s)." }),
    );
    expect(sentence).toContain("Word is not reachable");
  });

  it("treats an empty message as no message rather than announcing nothing", () => {
    // An empty string is a real failure mode of a message prop, and reading it
    // as a settled state would clear the queue mid-run.
    expect(deriveAnnouncement(state({ applyMessage: "", scanPhase: "fresh", findingCount: 1 }))).toBe(
      "Scan complete. 1 finding.",
    );
  });

  it("returns null once a scan is no longer running and nothing else has said anything", () => {
    expect(deriveAnnouncement(state({ scanPhase: "notStarted" }))).toBeNull();
  });
});
