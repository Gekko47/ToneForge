import React from "react";

/**
 * Deterministic Review, with no deterministic style profile.
 *
 * **This page exists because the dashboard used to show Home here instead.**
 *
 * `DashboardWithoutProfile` rendered a branch per destination and fell through to
 * Home for anything it had no branch for. Two destinations had no branch:
 * `review` and `semantic-review`. Choosing either from the drawer, or arriving
 * on Semantic Review and pressing Back to Deterministic Review, therefore landed
 * on the setup checklist — which looks exactly like the press did nothing. It was
 * reported as the two pages being "stuck showing what the home page shows".
 *
 * The cause is not an unconfigured AI provider, as the report guessed. It is an
 * absent **deterministic style profile**, which is the one thing this page
 * genuinely needs. Either way the fix is the same and is the principle the
 * component above this one already states: every destination is reachable, and
 * each renders **its own state** rather than being redirected.
 *
 * Semantic Review needs no deterministic profile and now renders its real page;
 * this one has nothing to render, because with no profile there are no rules, no
 * findings and nothing that could be planned. So it states that once and names
 * the control that resolves it (ADR-0069), rather than pretending an empty list
 * means the document is clean.
 */
export interface ReviewWithoutProfileProps {
  onBack: () => void;
  /** Opens the control that resolves it, per ADR-0069. */
  onOpenProfile: () => void;
}

export default function ReviewWithoutProfile({
  onBack,
  onOpenProfile,
}: ReviewWithoutProfileProps): React.ReactNode {
  return (
    <div className="tf-card" data-page="review">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button className="tf-native-button" type="button" onClick={onBack}>
          Back to Home
        </button>
      </nav>

      <h1 className="tf-title">Deterministic Review</h1>
      <p className="tf-sub">
        This page compares the document against a deterministic style profile. No profile is active,
        so there is nothing to compare against and nothing to apply.
      </p>

      {/*
        This page's one live region (ADR-0062). The remedy is an ordinary button
        beside the sentence that explains it, not a second region, so opening the
        page does not announce itself before the user has done anything.
      */}
      <p role="status" className="tf-sub">
        No deterministic style profile is active. Open Deterministic Style Profile to create one.
      </p>

      <section aria-label="Findings section" className="tf-collapsible">
        <h2>Findings</h2>
        <p className="tf-sub">
          No findings, because no scan has run against a profile. This is not the same as a document
          with nothing wrong with it, and nothing will be written until a profile exists and you
          approve each change.
        </p>
      </section>

      <div className="tf-actions">
        <button className="tf-native-button" type="button" onClick={onOpenProfile}>
          Deterministic Style Profile
        </button>
      </div>
    </div>
  );
}
