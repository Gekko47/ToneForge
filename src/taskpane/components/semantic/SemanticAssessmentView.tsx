import React from "react";
import type { SemanticAssessment } from "../../../analysis/semantic/contracts";

/**
 * The assessment, dimension by dimension.
 *
 * **Not a `FindingDetail`.** The specification says so, and the reason is the
 * substance rather than the styling: a `Finding` is a machine-verified breach with
 * a rule behind it, a severity, a confidence and a location, and rendering a
 * model's opinion in that shape tells the user it is the same kind of thing as the
 * findings beside it. It is not. The assessment is the model's account of how the
 * selection reads against the profile, and it is rendered as that.
 *
 * Each observation carries the dimension it is about, how far it aligned, and the
 * model's own sentence — so a user who disagrees can say which dimension they
 * disagree about rather than only that they disagree.
 */
export interface SemanticAssessmentViewProps {
  assessment: SemanticAssessment;
}

const ALIGNMENT_LABEL: Record<SemanticAssessment["observations"][number]["alignment"], string> = {
  aligned: "Matches",
  minor_deviation: "Minor deviation",
  material_deviation: "Material deviation",
};

/** A dimension's field name, spelled out for a reader who has not seen the schema. */
const DIMENSION_LABEL: Record<SemanticAssessment["observations"][number]["dimension"], string> = {
  tone: "Tone",
  voice: "Voice",
  formality: "Formality",
  register: "Register",
  assertionStyle: "Assertion style",
  qualificationStyle: "Qualification",
  evidenceFraming: "Evidence framing",
  uncertaintyStyle: "Uncertainty",
  sentenceArchitecture: "Sentence architecture",
  paragraphArchitecture: "Paragraph architecture",
  transitions: "Transitions",
  agency: "Agency",
  technicality: "Technicality",
  rhetoricalStyle: "Rhetorical style",
  conclusionStyle: "Conclusion style",
  lexicalPreferences: "Word choice",
};

export default function SemanticAssessmentView({
  assessment,
}: SemanticAssessmentViewProps): React.ReactNode {
  return (
    <section aria-labelledby="tf-semantic-assessment" className="tf-card">
      <h2 id="tf-semantic-assessment">How this reads against your style</h2>
      <p className="tf-sub">{assessment.summary}</p>
      <dl className="tf-assessment-list">
        {assessment.observations.map((observation, index) => (
          <div key={`${observation.dimension}-${index}`}>
            <dt>
              {DIMENSION_LABEL[observation.dimension]} — {ALIGNMENT_LABEL[observation.alignment]}
            </dt>
            <dd>
              {observation.explanation}
              {observation.evidenceQuote !== undefined && (
                <>
                  {" "}
                  <q>{observation.evidenceQuote}</q>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
