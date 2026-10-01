/**
 * The semantic gates (spec §26).
 *
 * Pure, so no render is needed — and the point of these cases is that a control
 * cannot be enabled without the sentence beside it. Each case asserts *both*
 * halves: `allowed` for the button and `blocker` for the explanation, because a
 * gate that disabled correctly while saying nothing was the old tab's defect in
 * reverse, and a gate that explained while allowing was the defect as written.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_REVIEW_SELECTION_CHARS,
  reviewUnavailableReason,
  semanticGate,
  type SemanticGateInput,
} from "../../../../src/taskpane/semantic/gates";

const READY: SemanticGateInput = {
  consent: true,
  providerConfigured: true,
  hasProfile: true,
  hasSelection: true,
  reviewing: false,
  applying: false,
  hasProposal: true,
  preservationPassed: true,
  warningsAcknowledged: true,
  selectionChars: 220,
};

describe("semanticGate", () => {
  describe("consent and provider", () => {
    it("blocks every sending action without consent, and points at Settings", () => {
      (["review", "regenerate", "apply", "keep-original", "learn"] as const).forEach((action) => {
        const gate = semanticGate({ ...READY, consent: false }, action);
        expect(gate.allowed).toBe(false);
        expect(gate.blocker).toMatch(/consent/i);
        expect(gate.remedy).toEqual({ destination: "settings", label: "Open Settings" });
      });
    });

    it("blocks every sending action without a provider", () => {
      const gate = semanticGate({ ...READY, providerConfigured: false }, "review");
      expect(gate.allowed).toBe(false);
      expect(gate.blocker).toMatch(/provider/i);
      expect(gate.remedy?.destination).toBe("settings");
    });

    it("still lets a selection be read without consent, because it sends nothing", () => {
      // The old tab disabled "Read current selection" on consent, so a user who
      // declined AI could not see what they had selected.
      expect(semanticGate({ ...READY, consent: false }, "read-selection").allowed).toBe(true);
      expect(semanticGate({ ...READY, providerConfigured: false }, "read-selection").allowed).toBe(
        true,
      );
    });
  });

  describe("review", () => {
    it("allows a review once every precondition holds", () => {
      expect(semanticGate(READY, "review")).toEqual({ allowed: true, blocker: null, remedy: null });
    });

    it("names the style page when there is no profile", () => {
      const gate = semanticGate({ ...READY, hasProfile: false }, "review");
      expect(gate.allowed).toBe(false);
      expect(gate.remedy?.destination).toBe("semantic-style");
    });

    it("tells the user to select something, rather than sending an empty request", () => {
      const gate = semanticGate({ ...READY, hasSelection: false }, "review");
      expect(gate.allowed).toBe(false);
      expect(gate.blocker).toMatch(/select/i);
      expect(gate.remedy).toBeNull();
    });

    it("refuses a selection over the cap rather than truncating it", () => {
      const gate = semanticGate(
        { ...READY, selectionChars: MAX_REVIEW_SELECTION_CHARS + 1 },
        "review",
      );
      expect(gate.allowed).toBe(false);
      expect(gate.blocker).toMatch(/select less text/i);
    });

    it("allows a selection exactly at the cap", () => {
      expect(
        semanticGate({ ...READY, selectionChars: MAX_REVIEW_SELECTION_CHARS }, "review").allowed,
      ).toBe(true);
    });

    it("blocks while a request is in flight, and says so", () => {
      const gate = semanticGate({ ...READY, reviewing: true }, "review");
      expect(gate.allowed).toBe(false);
      expect(gate.blocker).toMatch(/wait for the current request/i);
    });
  });

  describe("apply", () => {
    it("allows an approved, preservation-clean proposal", () => {
      expect(semanticGate(READY, "apply").allowed).toBe(true);
    });

    it("refuses a hard preservation failure with no override", () => {
      const gate = semanticGate({ ...READY, preservationPassed: false }, "apply");
      expect(gate.allowed).toBe(false);
      expect(gate.blocker).toMatch(/cannot be applied/i);
      expect(gate.remedy).toBeNull();
    });

    it("requires an acknowledgement while soft warnings stand", () => {
      const gate = semanticGate({ ...READY, warningsAcknowledged: false }, "apply");
      expect(gate.allowed).toBe(false);
      expect(gate.blocker).toMatch(/confirm/i);
    });

    it("refuses before there is anything to apply", () => {
      expect(semanticGate({ ...READY, hasProposal: false }, "apply").blocker).toMatch(
        /review the selection first/i,
      );
    });

    it("blocks while a write is in flight", () => {
      expect(semanticGate({ ...READY, applying: true }, "apply").allowed).toBe(false);
    });
  });

  describe("keep original", () => {
    it("is available exactly when a proposal is", () => {
      expect(semanticGate(READY, "keep-original").allowed).toBe(true);
      expect(semanticGate({ ...READY, hasProposal: false }, "keep-original").allowed).toBe(false);
    });

    it("does not require the proposal to be appliable, because declining needs nothing", () => {
      const refused = { ...READY, preservationPassed: false, warningsAcknowledged: false };
      expect(semanticGate(refused, "apply").allowed).toBe(false);
      expect(semanticGate(refused, "keep-original").allowed).toBe(true);
    });
  });
});

describe("reviewUnavailableReason", () => {
  it("is the review gate's own blocker, so the card and the button cannot disagree", () => {
    expect(reviewUnavailableReason(READY)).toBeNull();
    expect(reviewUnavailableReason({ ...READY, hasSelection: false })).toBe(
      semanticGate({ ...READY, hasSelection: false }, "review").blocker,
    );
  });
});
