/**
 * Every enabled/disabled decision on the two semantic pages, in one pure module.
 *
 * **Why a module and not a `disabled={...}` in each component.** The old Semantic
 * tab derived `consentMissing` and `providerMissing` and used only the first;
 * `providerMissing` was computed and never disabled anything, so a Propose button
 * could be enabled with no provider to ask. A second problem follows from the
 * first: a button that is disabled for a reason the user cannot see is the same
 * as a button that is broken, and Troubleshooting could not answer "why is this
 * greyed out" because the reason was never written down anywhere.
 *
 * So each gate answers two questions — may this action run, and if not, what does
 * the user do about it — and both live here rather than in a component, which
 * makes the whole set testable without rendering and impossible to drift between
 * the button and the sentence beside it. ADR-0069: every refusal names the control
 * that resolves it.
 *
 * Pure by construction. No Word, no provider, no React: the inputs are facts the
 * caller already has.
 */

/**
 * The longest selection a review will accept.
 *
 * Linear in the selection for both the prompt and the local preservation check,
 * so an unbounded selection is an unbounded request. A stated refusal above the
 * cap, rather than a silent truncation: a review of the first 20 000 characters of
 * someone's paragraph is not a review of their paragraph (spec §29, plan §14).
 */
export const MAX_REVIEW_SELECTION_CHARS = 20_000;

/** What a blocked action needs the user to do, and where that lives. */
export type SemanticRemedy =
  { destination: "settings"; label: string } | { destination: "semantic-style"; label: string };

export type SemanticAction =
  "read-selection" | "review" | "regenerate" | "apply" | "keep-original" | "learn";

export interface SemanticGateInput {
  /** `settings.semanticOptIn`, re-derived from a strict boolean on every load. */
  consent: boolean;
  /** A remote provider is configured *and* reachable. */
  providerConfigured: boolean;
  /** A semantic profile exists to review against. */
  hasProfile: boolean;
  /** A selection has been captured and is not empty. */
  hasSelection: boolean;
  /** A review is in flight. */
  reviewing: boolean;
  /** An apply is in flight. */
  applying: boolean;
  /** A proposal is on screen. */
  hasProposal: boolean;
  /** The local preservation check passed for the proposal on screen. */
  preservationPassed: boolean;
  /** Soft warnings have been acknowledged, where there are any. */
  warningsAcknowledged: boolean;
  /** Characters in the captured selection. */
  selectionChars: number;
}

export interface SemanticGate {
  allowed: boolean;
  /**
   * One sentence, or `null` when the action is allowed.
   *
   * A sentence rather than a code because it is what the pane shows; the code is
   * implied by which sentence it is, and a second representation of the same
   * decision is a second thing to keep in step.
   */
  blocker: string | null;
  remedy: SemanticRemedy | null;
}

const ALLOWED: SemanticGate = { allowed: true, blocker: null, remedy: null };

/**
 * A refusal with no single control to point at.
 *
 * `remedy` is `null` rather than a filler destination because these blockers are
 * resolved by doing something in the pane — selecting text, waiting — not by
 * going somewhere else, and a button that navigates nowhere is worse than no
 * button.
 */
function blocked(blocker: string, remedy: SemanticRemedy | null): SemanticGate {
  return { allowed: false, blocker, remedy };
}

const CONSENT_BLOCKER =
  "Semantic review sends the text you select to your configured provider, which needs its own consent in Settings. It is not covered by the other review permissions.";
const PROVIDER_BLOCKER = "No AI provider is configured, so there is nothing to ask.";
const PROFILE_BLOCKER = "There is no semantic style to review against yet.";
const SELECTION_BLOCKER = "Select the paragraph or text you want ToneForge to review.";
const SELECTION_CAP_BLOCKER =
  "The selection is longer than ToneForge will send in one review. Select less text, or split the review into two.";
const NO_PROPOSAL_BLOCKER = "Review the selection first.";
const PRESERVATION_BLOCKER =
  "This revision changes something the local check protects, so it cannot be applied.";
const ACKNOWLEDGEMENT_BLOCKER = "Confirm the warnings above before applying this revision.";
const BUSY_BLOCKER = "Wait for the current request to finish.";

/**
 * Whether one action may run now, and what to tell the user if it may not.
 *
 * Ordered by *what the user can act on*, not by what is checked first internally:
 * a missing profile is worth reporting before an in-flight request, because the
 * request will not fix it. Consent and provider come first for every action that
 * would send text, because they are the two the user has to grant rather than
 * supply.
 */
export function semanticGate(input: SemanticGateInput, action: SemanticAction): SemanticGate {
  // Reading a selection is a local Word call and sends nothing, so neither consent
  // nor a provider may block it — otherwise a user who declined AI consent could
  // not even look at what they have selected.
  if (action === "read-selection") {
    return ALLOWED;
  }

  if (action === "learn") {
    if (!input.consent)
      return blocked(CONSENT_BLOCKER, { destination: "settings", label: "Open Settings" });
    if (!input.providerConfigured) {
      return blocked(PROVIDER_BLOCKER, { destination: "settings", label: "Open Settings" });
    }
    return ALLOWED;
  }

  if (!input.consent) {
    return blocked(CONSENT_BLOCKER, { destination: "settings", label: "Open Settings" });
  }
  if (!input.providerConfigured) {
    return blocked(PROVIDER_BLOCKER, { destination: "settings", label: "Open Settings" });
  }
  if (action === "review" || action === "regenerate") {
    if (!input.hasProfile) {
      return blocked(PROFILE_BLOCKER, {
        destination: "semantic-style",
        label: "Open Semantic Style",
      });
    }
    if (!input.hasSelection) return blocked(SELECTION_BLOCKER, null);
    if (input.selectionChars > MAX_REVIEW_SELECTION_CHARS) {
      return blocked(SELECTION_CAP_BLOCKER, null);
    }
    if (input.reviewing || input.applying) return blocked(BUSY_BLOCKER, null);
    return ALLOWED;
  }

  // Everything below acts on a proposal that is already on screen.
  if (action === "keep-original") {
    if (!input.hasProposal) return blocked(NO_PROPOSAL_BLOCKER, null);
    if (input.applying) return blocked(BUSY_BLOCKER, null);
    return ALLOWED;
  }

  if (!input.hasProposal) return blocked(NO_PROPOSAL_BLOCKER, null);
  if (input.applying) return blocked(BUSY_BLOCKER, null);
  if (!input.preservationPassed) return blocked(PRESERVATION_BLOCKER, null);
  if (!input.warningsAcknowledged) return blocked(ACKNOWLEDGEMENT_BLOCKER, null);
  return ALLOWED;
}

/**
 * Whether the pane has everything it needs to offer a review at all.
 *
 * A convenience over `semanticGate(input, "review")`, so the two cannot be read
 * as different questions: the button's disabled state and the scope card's
 * "you cannot review yet" state come from one answer.
 */
export function reviewUnavailableReason(input: SemanticGateInput): string | null {
  const gate = semanticGate(input, "review");
  return gate.allowed ? null : gate.blocker;
}
