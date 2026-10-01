import React from "react";
import type { PreservationReport } from "../../../analysis/semantic/preservationValidator";
import type { MeaningPreservationAssessment } from "../../../analysis/semantic/contracts";

/**
 * What the local check found, and what the model said it preserved.
 *
 * **Two tiers, and the panel never merges them.** A hard failure is a protected
 * token — a date, an amount, a reference — that moved, and it disables Apply with
 * no override. A soft warning is something a validator can see move and not say
 * what it means, and it requires one explicit acknowledgement. The
 * specification's own list would have put `if`, `not` and `only` in the hard tier,
 * which fires on nearly every expert sentence; a gate the user learns to click
 * through without reading is a gate that will not be there when it matters (D6).
 *
 * **The model's flags are evidence, not a verdict.** They are shown with the
 * model's own sentence quoted, and a `false` adds a soft warning rather than
 * disabling anything — a model asked whether its own work is safe will say yes.
 */
export interface PreservationSummaryProps {
  report: PreservationReport;
  meaning: MeaningPreservationAssessment;
  /** The user's acknowledgement of the soft warnings, for this session. */
  acknowledged: boolean;
  onAcknowledge: (acknowledged: boolean) => void;
}

const MEANING_LABEL: Record<keyof MeaningPreservationAssessment, string> = {
  qualificationPreserved: "Hedging",
  attributionPreserved: "Attribution",
  causationPreserved: "Causation",
  responsibilityPreserved: "Responsibility",
  certaintyPreserved: "Certainty",
};

export default function PreservationSummary({
  report,
  meaning,
  acknowledged,
  onAcknowledge,
}: PreservationSummaryProps): React.ReactNode {
  const hard = report.warnings.filter((warning) => warning.tier === "hard");
  const soft = report.warnings.filter((warning) => warning.tier === "soft");
  const unpreserved = (
    Object.keys(MEANING_LABEL) as (keyof MeaningPreservationAssessment)[]
  ).filter((key) => meaning[key] === false);

  return (
    <section aria-labelledby="tf-semantic-preservation" className="tf-card">
      <h2 id="tf-semantic-preservation">What this revision changes</h2>

      {report.warnings.length === 0 ? (
        <p className="tf-sub">
          Every date, amount, reference and qualifier in your paragraph is unchanged.
        </p>
      ) : (
        <ul className="tf-preservation-list">
          {report.warnings.map((warning, index) => (
            <li
              key={`${warning.kind}-${warning.term}-${index}`}
              className={warning.tier === "hard" ? "tf-preservation-hard" : "tf-preservation-soft"}
            >
              {warning.message}
            </li>
          ))}
        </ul>
      )}

      {hard.length > 0 && (
        <p className="tf-debug-warning">
          {report.summary} Nothing has been written, and regenerating is the only way to change this
          answer.
        </p>
      )}

      {hard.length === 0 && soft.length > 0 && (
        <div>
          <label htmlFor="tf-semantic-acknowledge">
            <input
              id="tf-semantic-acknowledge"
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => onAcknowledge(event.target.checked)}
            />
            I have read the differences above and want to apply this revision anyway.
          </label>
        </div>
      )}

      {unpreserved.length > 0 && (
        <p className="tf-sub">
          The model also reported that it did not preserve{" "}
          {unpreserved.map((key) => MEANING_LABEL[key].toLowerCase()).join(", ")}. That is the
          model's account of its own work, so read it beside the comparison rather than as a
          clearance.
        </p>
      )}
    </section>
  );
}
