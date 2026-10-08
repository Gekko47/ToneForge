import { ConsistencyReviewRequestSchema, type ConsistencyReviewRequest } from "./request";
import type { ConsistencyCheckId } from "./checkIds";

export { ConsistencyCheckIdSchema, type ConsistencyCheckId } from "./checkIds";

/**
 * The ten check identities, with their deterministic-first flags.
 *
 * `deterministicFirst` is the D9 realignment made explicit: a check that can
 * decide its own candidates does so, and only the residue it cannot settle
 * reaches the model. C1 (terminology drift) is deterministic-first; C8 and C9
 * (reference and section checks) are semantic because they reason about what a
 * reference points at, not about a value.
 */
export interface ConsistencyCheckDescriptor {
  readonly id: ConsistencyCheckId;
  readonly title: string;
  readonly question: string;
  readonly severity: "info" | "warning" | "error";
  readonly deterministicFirst: boolean;
}

export const CONSISTENCY_CHECKS: readonly ConsistencyCheckDescriptor[] = Object.freeze([
  {
    id: "C1",
    title: "Terminology drift",
    question: "Is the same term used two ways?",
    severity: "warning",
    deterministicFirst: true,
  },
  {
    id: "C2",
    title: "Numeric contradiction",
    question: "Is the same figure given two values?",
    severity: "error",
    deterministicFirst: true,
  },
  {
    id: "C3",
    title: "Temporal conflict",
    question: "Are two dates given for one event?",
    severity: "error",
    deterministicFirst: true,
  },
  {
    id: "C4",
    title: "Entity attribute conflict",
    question: "Does one entity carry two incompatible attributes?",
    severity: "warning",
    deterministicFirst: false,
  },
  {
    id: "C5",
    title: "Definitional conflict",
    question: "Is a defined term used against its definition?",
    severity: "warning",
    deterministicFirst: true,
  },
  {
    id: "C6",
    title: "Unit inconsistency",
    question: "Are incompatible units used for one quantity?",
    severity: "warning",
    deterministicFirst: true,
  },
  {
    id: "C7",
    title: "Status contradiction",
    question: "Is one thing stated in two exclusive states?",
    severity: "error",
    deterministicFirst: true,
  },
  {
    id: "C8",
    title: "Reference conflict",
    question: "Does a reference point at something that contradicts it?",
    severity: "warning",
    deterministicFirst: false,
  },
  {
    id: "C9",
    title: "Section promise mismatch",
    question: "Does a section fail to deliver what its heading promises?",
    severity: "info",
    deterministicFirst: false,
  },
  {
    id: "C10",
    title: "Scope contradiction",
    question: "Is one claim qualified two incompatible ways?",
    severity: "warning",
    deterministicFirst: false,
  },
]);

export const CONSISTENCY_CHECK_IDS: readonly ConsistencyCheckId[] = Object.freeze(
  CONSISTENCY_CHECKS.map((check) => check.id),
);

export function consistencyCheck(id: string): ConsistencyCheckDescriptor {
  const found = CONSISTENCY_CHECKS.find((check) => check.id === id);
  if (found === undefined) {
    throw new Error(`Unknown consistency check ${id}`);
  }
  return found;
}

/** Below this confidence a finding is advisory: shown, explained, never applied. */
export const CONSISTENCY_ACTIONABLE_CONFIDENCE = 0.7;

/**
 * The per-subject cap the run honours.
 *
 * A subject with more statements than this contributes the first
 * `CONSISTENCY_DEFAULT_MAX_PER_SUBJECT` and reports the rest as
 * `blockOverflowSkipped`. The preflight states the bound; the report states
 * how many comparisons were skipped.
 */
export const CONSISTENCY_DEFAULT_MAX_PER_SUBJECT = 400;

/** The most adjudications one run may consume. */
export const CONSISTENCY_DEFAULT_MAX_ADJUDICATIONS = 60;

/** Thrown when the request arrives without the explicit opt-in consent. */
export const CONSISTENCY_CONSENT_ERROR =
  "Cross-report consistency review needs its own consent in Settings. It is not covered by the other review permissions.";

/**
 * Parse a raw request, failing closed on consent.
 *
 * Anything other than `consistencyConsent: true` throws — a stored `"yes"`,
 * an absent field, a `false` — so a review the user did not agree to cannot
 * start. An empty `checks` array means all ten, so a UI that forgets to pass a
 * selection still runs the full set rather than silently running nothing.
 */
export function parseConsistencyReviewRequest(raw: unknown): ConsistencyReviewRequest {
  const parsed = ConsistencyReviewRequestSchema.parse(raw);
  if (parsed.consistencyConsent !== true) {
    throw new Error(CONSISTENCY_CONSENT_ERROR);
  }
  const checks = parsed.checks.length === 0 ? [...CONSISTENCY_CHECK_IDS] : parsed.checks;
  for (const id of checks) {
    consistencyCheck(id);
  }
  return { ...parsed, checks };
}
