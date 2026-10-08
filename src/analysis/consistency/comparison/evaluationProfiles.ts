/**
 * C-specific evaluation profiles (R4, original §15).
 *
 * Each check defines:
 * - required facts (what must be present to even ask)
 * - relevant E-questions (which E-questions apply)
 * - hard gates (comparability gates that terminate early)
 * - D-derivation rules (how E-vector maps to D-outcome)
 * - allowed CTX requests (what context the model may request)
 * - confidence profile (weights, thresholds, calibration version)
 *
 * These profiles are the contract between the deterministic resolver
 * and the decision model. The resolver answers every E-question it
 * can; the model is asked only the unresolved ones.
 */

import type { ConsistencyCheckId, DOutcome, EvaluationVector } from "../contracts";
import type { EQuestion } from "./deterministicEvaluationResolver";

/** One C-check's evaluation profile. */
export interface EvaluationProfile {
  readonly checkId: ConsistencyCheckId;
  /** Facts that must be present on both claims to even ask. */
  readonly requiredFacts: readonly string[];
  /** E-questions this check cares about. */
  readonly relevantEQuestions: readonly EQuestion[];
  /** Hard gates that terminate before the model. */
  readonly hardGates: readonly string[];
  /** D-derivation: map from E-vector to D-outcome. */
  readonly deriveDOutcome: (vector: EvaluationVector) => DOutcome | null;
  /** Context types the model may request for this check. */
  readonly allowedContextRequests: readonly string[];
  /** Confidence profile for this check. */
  readonly confidenceProfile: {
    readonly version: string;
    readonly weights: Partial<Record<EQuestion, number>>;
    readonly reviewThreshold: number;
    readonly presentationThreshold: number;
    readonly calibrationModelVersion?: string;
  };
}

/** The ten C-profiles, keyed by checkId. */
export const EVALUATION_PROFILES: Record<ConsistencyCheckId, EvaluationProfile> = {
  C1: {
    checkId: "C1",
    requiredFacts: ["entity", "predicate"],
    relevantEQuestions: [
      "E-ENTITY-SAME",
      "E-PREDICATE-COMPARABLE",
      "E-DEFINITION-INCOMPATIBLE",
      "E-EVIDENCE-SUFFICIENT",
      "E-SUBSTANTIVE-CONFLICT",
    ],
    hardGates: ["different-scenario", "different-attribution-domain", "insufficient-evidence"],
    deriveDOutcome: (vector) => {
      if (!vector.sameSubject) return "D-NOT-COMPARABLE";
      if (vector.sameSubject && vector.valuesAgree === false) return "D-CONFLICT";
      return null; // needs model for definition incompatibility
    },
    allowedContextRequests: ["CTX-DEFINITION", "CTX-USAGE"],
    confidenceProfile: {
      version: "1.0",
      weights: {
        "E-ENTITY-SAME": 0.3,
        "E-PREDICATE-COMPARABLE": 0.3,
        "E-DEFINITION-INCOMPATIBLE": 0.4,
      },
      reviewThreshold: 0.55,
      presentationThreshold: 0.7,
      calibrationModelVersion: "consistency_decision-v1",
    },
  },

  C2: {
    checkId: "C2",
    requiredFacts: [
      "entity",
      "event",
      "metric",
      "value",
      "unit",
      "scope",
      "scenario",
      "period",
      "programme",
      "attribution",
      "qualifiers",
    ],
    relevantEQuestions: [
      "E-ENTITY-SAME",
      "E-EVENT-SAME",
      "E-PREDICATE-COMPARABLE",
      "E-SCOPE-SAME",
      "E-SCENARIO-SAME",
      "E-ATTRIBUTION-COMPATIBLE",
      "E-MODALITY-COMPATIBLE",
      "E-TEMPORAL-COMPARABLE",
      "E-BASIS-SAME",
      "E-VALUE-INCOMPATIBLE",
      "E-QUALIFIER-RECONCILES",
      "E-EVIDENCE-SUFFICIENT",
      "E-UPDATE-SUPERSEDES",
      "E-PROGRAMME-BASIS-SAME",
      "E-DATA-DATE-COMPARABLE",
      "E-ANALYSIS-WINDOW-SAME",
      "E-MEASUREMENT-BASIS-SAME",
      "E-VALUATION-PERIOD-SAME",
      "E-CURRENCY-COMPATIBLE",
      "E-INCLUSIONS-SAME",
      "E-SUBSTANTIVE-CONFLICT",
    ],
    hardGates: [
      "different-scenario",
      "different-attribution-domain",
      "different-valuation-period",
      "different-programme-basis",
      "forecast-vs-actual",
      "different-measurement-basis",
      "entity-or-event-mismatch",
      "insufficient-evidence",
      "unresolved-source-evidence",
    ],
    deriveDOutcome: (vector) => {
      if (!vector.sameSubject) return "D-NOT-COMPARABLE";
      if (!vector.samePeriod) return "D-DIFFERENT-PERIOD";
      if (!vector.sameScenario) return "D-DIFFERENT-SCENARIO";
      if (!vector.sameBasis) return "D-DIFFERENT-BASIS";
      if (!vector.sameAttribution) return "D-DIFFERENT-ATTRIBUTION";
      if (vector.valuesAgree === false) {
        if (vector.unitsCompatible) return "D-CONFLICT";
        return "D-DIFFERENT-MEASUREMENT-BASIS";
      }
      if (!vector.unitsCompatible) return "D-DIFFERENT-MEASUREMENT-BASIS";
      if (!vector.qualifiersCompatible) return "D-QUALIFIED-POSITION";
      return "D-CONSISTENT";
    },
    allowedContextRequests: [
      "CTX-BASIS",
      "CTX-SCENARIO",
      "CTX-PERIOD",
      "CTX-PROGRAMME",
      "CTX-ATTRIBUTION",
    ],
    confidenceProfile: {
      version: "1.0",
      weights: {
        "E-VALUE-INCOMPATIBLE": 0.4,
        "E-SCENARIO-SAME": 0.2,
        "E-SCOPE-SAME": 0.15,
        "E-ATTRIBUTION-COMPATIBLE": 0.15,
        "E-QUALIFIER-RECONCILES": 0.1,
      },
      reviewThreshold: 0.6,
      presentationThreshold: 0.75,
      calibrationModelVersion: "consistency_decision-v1",
    },
  },

  C3: {
    checkId: "C3",
    requiredFacts: ["event", "temporal"],
    relevantEQuestions: [
      "E-EVENT-SAME",
      "E-TEMPORAL-COMPARABLE",
      "E-DATA-DATE-COMPARABLE",
      "E-ANALYSIS-WINDOW-SAME",
      "E-EVIDENCE-SUFFICIENT",
      "E-SUBSTANTIVE-CONFLICT",
    ],
    hardGates: [
      "different-scenario",
      "different-attribution-domain",
      "forecast-vs-actual",
      "insufficient-evidence",
    ],
    deriveDOutcome: (vector) => {
      if (!vector.sameSubject) return "D-NOT-COMPARABLE";
      if (!vector.samePeriod) return "D-DIFFERENT-PERIOD";
      if (vector.valuesAgree === false) return "D-CONFLICT";
      return "D-CONSISTENT";
    },
    allowedContextRequests: ["CTX-TEMPORAL", "CTX-EVENT"],
    confidenceProfile: {
      version: "1.0",
      weights: {
        "E-TEMPORAL-COMPARABLE": 0.5,
        "E-EVENT-SAME": 0.3,
        "E-DATA-DATE-COMPARABLE": 0.2,
      },
      reviewThreshold: 0.55,
      presentationThreshold: 0.7,
      calibrationModelVersion: "consistency_decision-v1",
    },
  },

  C4: {
    checkId: "C4",
    requiredFacts: ["entity", "attribute"],
    relevantEQuestions: [
      "E-ENTITY-SAME",
      "E-PREDICATE-COMPARABLE",
      "E-SCENARIO-SAME",
      "E-ATTRIBUTION-COMPATIBLE",
      "E-TEMPORAL-COMPARABLE",
      "E-EVIDENCE-SUFFICIENT",
      "E-SUBSTANTIVE-CONFLICT",
    ],
    hardGates: ["different-scenario", "different-attribution-domain", "insufficient-evidence"],
    deriveDOutcome: (vector) => {
      if (!vector.sameSubject) return "D-NOT-COMPARABLE";
      if (!vector.sameScenario) return "D-DIFFERENT-SCENARIO";
      if (vector.valuesAgree === false) return "D-CONFLICT";
      return null; // needs model for attribute incompatibility
    },
    allowedContextRequests: ["CTX-ATTRIBUTE", "CTX-ENTITY"],
    confidenceProfile: {
      version: "1.0",
      weights: {
        "E-ENTITY-SAME": 0.3,
        "E-PREDICATE-COMPARABLE": 0.3,
        "E-SCENARIO-SAME": 0.2,
        "E-ATTRIBUTION-COMPATIBLE": 0.2,
      },
      reviewThreshold: 0.5,
      presentationThreshold: 0.65,
      calibrationModelVersion: "consistency_decision-v1",
    },
  },

  C5: {
    checkId: "C5",
    requiredFacts: ["term", "definition"],
    relevantEQuestions: [
      "E-ENTITY-SAME",
      "E-PREDICATE-COMPARABLE",
      "E-DEFINITION-INCOMPATIBLE",
      "E-EVIDENCE-SUFFICIENT",
      "E-SUBSTANTIVE-CONFLICT",
    ],
    hardGates: ["different-scenario", "different-attribution-domain", "insufficient-evidence"],
    deriveDOutcome: (vector) => {
      if (!vector.sameSubject) return "D-NOT-COMPARABLE";
      return null; // definition incompatibility needs model
    },
    allowedContextRequests: ["CTX-DEFINITION", "CTX-USAGE"],
    confidenceProfile: {
      version: "1.0",
      weights: {
        "E-DEFINITION-INCOMPATIBLE": 0.5,
        "E-PREDICATE-COMPARABLE": 0.3,
        "E-EVIDENCE-SUFFICIENT": 0.2,
      },
      reviewThreshold: 0.5,
      presentationThreshold: 0.65,
      calibrationModelVersion: "consistency_decision-v1",
    },
  },

  C6: {
    checkId: "C6",
    requiredFacts: ["entity", "event", "metric", "value", "unit"],
    relevantEQuestions: [
      "E-ENTITY-SAME",
      "E-EVENT-SAME",
      "E-PREDICATE-COMPARABLE",
      "E-CURRENCY-COMPATIBLE",
      "E-VALUE-INCOMPATIBLE",
      "E-EVIDENCE-SUFFICIENT",
      "E-SUBSTANTIVE-CONFLICT",
    ],
    hardGates: [
      "different-scenario",
      "different-attribution-domain",
      "entity-or-event-mismatch",
      "insufficient-evidence",
    ],
    deriveDOutcome: (vector) => {
      if (!vector.sameSubject) return "D-NOT-COMPARABLE";
      if (!vector.unitsCompatible) return "D-DIFFERENT-MEASUREMENT-BASIS";
      if (vector.valuesAgree === false) return "D-CONFLICT";
      return "D-CONSISTENT";
    },
    allowedContextRequests: ["CTX-UNIT", "CTX-CURRENCY"],
    confidenceProfile: {
      version: "1.0",
      weights: {
        "E-VALUE-INCOMPATIBLE": 0.5,
        "E-CURRENCY-COMPATIBLE": 0.3,
        "E-ENTITY-SAME": 0.2,
      },
      reviewThreshold: 0.6,
      presentationThreshold: 0.75,
      calibrationModelVersion: "consistency_decision-v1",
    },
  },

  C7: {
    checkId: "C7",
    requiredFacts: ["entity", "event", "status"],
    relevantEQuestions: [
      "E-ENTITY-SAME",
      "E-EVENT-SAME",
      "E-STATUS-MUTUALLY-EXCLUSIVE",
      "E-TEMPORAL-COMPARABLE",
      "E-PROGRAMME-BASIS-SAME",
      "E-UPDATE-SUPERSEDES",
      "E-EVIDENCE-SUFFICIENT",
      "E-SUBSTANTIVE-CONFLICT",
    ],
    hardGates: [
      "different-scenario",
      "different-attribution-domain",
      "different-programme-basis",
      "forecast-vs-actual",
      "insufficient-evidence",
    ],
    deriveDOutcome: (vector) => {
      if (!vector.sameSubject) return "D-NOT-COMPARABLE";
      if (!vector.samePeriod) return "D-DIFFERENT-PERIOD";
      if (!vector.sameBasis) return "D-DIFFERENT-BASIS";
      if (vector.valuesAgree === false) return "D-CONFLICT";
      return "D-CONSISTENT";
    },
    allowedContextRequests: ["CTX-STATUS", "CTX-PROGRAMME"],
    confidenceProfile: {
      version: "1.0",
      weights: {
        "E-STATUS-MUTUALLY-EXCLUSIVE": 0.5,
        "E-TEMPORAL-COMPARABLE": 0.2,
        "E-PROGRAMME-BASIS-SAME": 0.2,
        "E-UPDATE-SUPERSEDES": 0.1,
      },
      reviewThreshold: 0.55,
      presentationThreshold: 0.7,
      calibrationModelVersion: "consistency_decision-v1",
    },
  },

  C8: {
    checkId: "C8",
    requiredFacts: ["reference", "citation"],
    relevantEQuestions: [
      "E-REFERENCE-SUPPORTS-CLAIM",
      "E-EVIDENCE-SUFFICIENT",
      "E-SUBSTANTIVE-CONFLICT",
    ],
    hardGates: ["different-scenario", "different-attribution-domain", "insufficient-evidence"],
    deriveDOutcome: (vector) => {
      if (!vector.sameSubject) return "D-NOT-COMPARABLE";
      return null; // reference support needs model
    },
    allowedContextRequests: ["CTX-REFERENCE", "CTX-CITATION"],
    confidenceProfile: {
      version: "1.0",
      weights: {
        "E-REFERENCE-SUPPORTS-CLAIM": 0.6,
        "E-EVIDENCE-SUFFICIENT": 0.4,
      },
      reviewThreshold: 0.5,
      presentationThreshold: 0.65,
      calibrationModelVersion: "consistency_decision-v1",
    },
  },

  C9: {
    checkId: "C9",
    requiredFacts: ["section", "promise"],
    relevantEQuestions: [
      "E-SECTION-FULFILS-PROMISE",
      "E-EVIDENCE-SUFFICIENT",
      "E-SUBSTANTIVE-CONFLICT",
    ],
    hardGates: ["different-scenario", "different-attribution-domain", "insufficient-evidence"],
    deriveDOutcome: (vector) => {
      if (!vector.sameSubject) return "D-NOT-COMPARABLE";
      return null; // section fulfilment needs model
    },
    allowedContextRequests: ["CTX-SECTION", "CTX-PROMISE"],
    confidenceProfile: {
      version: "1.0",
      weights: {
        "E-SECTION-FULFILS-PROMISE": 0.6,
        "E-EVIDENCE-SUFFICIENT": 0.4,
      },
      reviewThreshold: 0.5,
      presentationThreshold: 0.65,
      calibrationModelVersion: "consistency_decision-v1",
    },
  },

  C10: {
    checkId: "C10",
    requiredFacts: ["scope", "qualifiers"],
    relevantEQuestions: [
      "E-SCOPE-SAME",
      "E-SCOPE-EXCEPTION",
      "E-QUALIFIER-RECONCILES",
      "E-EVIDENCE-SUFFICIENT",
      "E-SUBSTANTIVE-CONFLICT",
    ],
    hardGates: ["different-scenario", "different-attribution-domain", "insufficient-evidence"],
    deriveDOutcome: (vector) => {
      if (!vector.sameSubject) return "D-NOT-COMPARABLE";
      if (!vector.sameScope) return "D-DIFFERENT-SCOPE";
      if (!vector.qualifiersCompatible) return "D-QUALIFIED-POSITION";
      return "D-CONSISTENT";
    },
    allowedContextRequests: ["CTX-SCOPE", "CTX-QUALIFIER"],
    confidenceProfile: {
      version: "1.0",
      weights: {
        "E-SCOPE-EXCEPTION": 0.4,
        "E-SCOPE-SAME": 0.3,
        "E-QUALIFIER-RECONCILES": 0.3,
      },
      reviewThreshold: 0.5,
      presentationThreshold: 0.65,
      calibrationModelVersion: "consistency_decision-v1",
    },
  },
};

/** Get the profile for a check, or throw if unknown. */
export function evaluationProfile(checkId: ConsistencyCheckId): EvaluationProfile {
  const profile = EVALUATION_PROFILES[checkId];
  if (profile === undefined) {
    throw new Error(`No evaluation profile for check ${checkId}`);
  }
  return profile;
}

/** All E-questions that any profile considers relevant. */
export function allRelevantEQuestions(): readonly EQuestion[] {
  const set = new Set<EQuestion>();
  for (const profile of Object.values(EVALUATION_PROFILES)) {
    profile.relevantEQuestions.forEach((q) => set.add(q));
  }
  return [...set];
}
