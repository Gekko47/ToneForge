/**
 * The semantic announcement (ADR-0062, ADR-0069).
 *
 * Moved from the deleted `Semantic.test.tsx` with the function it tests. The
 * priority order is the whole of the behaviour, so it is asserted without
 * rendering anything — a component test would only fail when a component changed,
 * which is not what this contract is about.
 */

import { describe, expect, it } from "vitest";
import { deriveSemanticAnnouncement } from "../../../../src/taskpane/state/semanticAnnouncement";

describe("deriveSemanticAnnouncement", () => {
  it("speaks an error in preference to a success", () => {
    const announcement = deriveSemanticAnnouncement({
      status: "Learned from a pasted sample.",
      error: "The provider refused the request.",
      selection: null,
    });

    // The user pressed a button that did not do what it said, which is the more
    // urgent thing to hear.
    expect(announcement).toEqual({ text: "The provider refused the request.", assertive: true });
  });

  it("falls back to the success once there is no error", () => {
    expect(
      deriveSemanticAnnouncement({
        status: "Learned from a pasted sample.",
        error: null,
        selection: null,
      }),
    ).toEqual({ text: "Learned from a pasted sample.", assertive: false });
  });

  it("announces the held selection when nothing else has happened", () => {
    expect(
      deriveSemanticAnnouncement({ status: null, error: null, selection: "186 words selected" }),
    ).toEqual({ text: "Selection read: 186 words selected", assertive: false });
  });

  it("says nothing at all when nothing has happened", () => {
    // `null` rather than an empty sentence: an empty region re-announced every
    // render is noise, and the caller can leave its region alone.
    expect(deriveSemanticAnnouncement({ status: null, error: null, selection: null })).toBeNull();
  });

  it("ignores an empty string rather than speaking nothing as an event", () => {
    expect(deriveSemanticAnnouncement({ status: "", error: "", selection: "" })).toBeNull();
  });
});
