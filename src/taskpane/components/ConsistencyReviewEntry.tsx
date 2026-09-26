/**
 * ConsistencyReviewEntry — the only visible way to start a cross-report review.
 *
 * Three properties this component exists to guarantee, each of which is a way
 * the engine could be started by accident:
 *
 * 1. **Its own opt-in.** The button is gated on `consistencyReviewConsent`, which
 *    is a third flag. The other two consents do not enable it, and the wording
 *    says so, because a user who has already agreed to send a selection has not
 *    agreed to send a whole document to be compared against itself.
 * 2. **Whole document only.** There is no selection or paragraph variant. A
 *    cross-report check over a partial document is not a weaker version of the
 *    same thing; it is a different and much less meaningful one, so the entry
 *    does not pretend to offer it.
 * 3. **Nothing runs on its own.** No observer, no incremental path, no keystroke.
 *    The button is the whole trigger.
 */

import React from "react";

export interface ConsistencyReviewEntryProps {
  providerConfigured: boolean;
  hasConsent: boolean;
  onStart: () => void;
  onOpenSettings: () => void;
}

export default function ConsistencyReviewEntry({
  providerConfigured,
  hasConsent,
  onStart,
  onOpenSettings,
}: ConsistencyReviewEntryProps): React.ReactNode {
  // Consent is checked before capability and the button explains which one is
  // missing, rather than simply refusing: a disabled control with no reason is
  // the least useful thing a settings-gated feature can do.
  let message: string | null = null;
  if (!hasConsent) {
    message =
      "Cross-report consistency review needs its own consent in Settings. It is separate from the other review permissions and is not covered by them.";
  } else if (!providerConfigured) {
    message = "Configure an AI provider in Settings first. Deterministic review remains available.";
  }

  return (
    <section aria-label="Consistency Review" className="tf-consent-block">
      <h2>Consistency Review (optional)</h2>
      <p>
        Checks whether different parts of the document disagree with each other — the same figure
        given two values, two different dates for one event, a term used two ways.
      </p>
      <p className="tf-sub">
        This is a separate check from the reviews above. It always covers the whole document at
        once, it uses a language model to judge anything the direct comparison cannot settle, and
        some of its answers can be wrong. It runs only when you choose it, and you can withdraw
        consent in Settings at any time.
      </p>
      {!providerConfigured && (
        <div role="status">
          <p>No AI provider is configured. Deterministic review remains available.</p>
          <button type="button" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={onStart}
        disabled={!hasConsent || !providerConfigured}
        aria-describedby={message ? "consistency-review-hint" : undefined}
      >
        Review this document for internal consistency
      </button>
      {message && (
        <p id="consistency-review-hint" className="tf-sub">
          {message}
        </p>
      )}
    </section>
  );
}
