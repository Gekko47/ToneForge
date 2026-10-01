/**
 * The local factual-preservation validator.
 *
 * **This is the gate between a model's prose and a user's document.** It runs
 * before Apply is offered, it runs entirely locally, and it produces the only
 * reason the user is shown for a refusal that is not a Word failure.
 *
 * Two tiers, and the split is the design:
 *
 * - **Hard failures** are changes to a token the extractor is *certain* about —
 *   a date, a currency amount, a percentage, a duration, a recognised
 *   identifier, a clause reference, a party name. These disable Apply. The
 *   reasoning is that a style-only revision which alters any of them is not a
 *   style revision.
 * - **Soft warnings** are changes to a token the extractor is not certain
 *   about, and to qualifiers and negations. These require an explicit
 *   acknowledgement. A bare number, a capitalised run that might be an entity,
 *   and the word `only` are all things a validator can see move and not be able
 *   to say what it means. Blocking on those would fire on nearly every real
 *   sentence, and a gate the user learns to click through without reading is a
 *   gate that will not be there when it matters.
 *
 * `changed` is reported rather than only `missing` and `added` because a
 * refusal the user cannot act on is half a refusal: "a date changed" tells them
 * what to look at, and showing `30 June 2025 → 18 July 2025` tells them which
 * one.
 *
 * Boundary rule (enforced by an ESLint scope): no `ai/`, no `word/`, no
 * `taskpane/`. This runs before any provider is consulted, and must keep
 * working when none is configured.
 */

import {
  extractProtectedFacts,
  type ProtectedFact,
  type ProtectedFactKind,
} from "./protectedFacts";
import {
  countTerm,
  extractQualifiers,
  NEGATION_TERMS,
  qualifierMessage,
  QUALIFIER_TERMS,
  type QualifierClass,
} from "./qualifiers";

/** How serious a difference is, and therefore what the product does about it. */
export const PRESERVATION_TIERS = ["hard", "soft"] as const;
export type PreservationTier = (typeof PRESERVATION_TIERS)[number];

/** One protected token that moved. */
export interface FactChange {
  readonly kind: ProtectedFactKind;
  readonly from: ProtectedFact;
  readonly to: ProtectedFact;
  readonly tier: PreservationTier;
  /** A sentence naming the change, ready to show. */
  readonly message: string;
}

/** A difference the product reports without refusing. */
export interface PreservationWarning {
  readonly kind: ProtectedFactKind | QualifierClass;
  readonly term: string;
  readonly surface: string;
  readonly tier: PreservationTier;
  readonly direction: "added" | "removed";
  readonly message: string;
}

/**
 * The whole verdict on one pair of texts.
 *
 * `pass` is true when nothing in the hard tier moved. `requiresAcknowledgement`
 * is separate, because a revision can pass and still have soft warnings — and
 * without this flag, "a soft warning may require explicit extra confirmation
 * depending on risk policy" has nowhere to live, so the confirmation is either
 * always demanded or never available.
 */
export interface PreservationReport {
  readonly pass: boolean;
  readonly requiresAcknowledgement: boolean;
  readonly originalFacts: readonly ProtectedFact[];
  readonly proposedFacts: readonly ProtectedFact[];
  /** Protected tokens in the original that are gone. */
  readonly missing: readonly ProtectedFact[];
  /** Protected tokens in the proposal that were not in the original. */
  readonly added: readonly ProtectedFact[];
  /** Protected tokens of one kind replaced by a different one of that kind. */
  readonly changed: readonly FactChange[];
  readonly warnings: readonly PreservationWarning[];
  /** Headline for the refusal panel; empty when the report passes. */
  readonly summary: string;
}

/** Human-readable class names, used in every message the validator emits. */
const KIND_NAMES: Readonly<Record<ProtectedFactKind, string>> = {
  date: "date",
  duration: "duration",
  percentage: "percentage",
  currency: "amount",
  quantity: "number",
  activityIdentifier: "activity reference",
  eventIdentifier: "event reference",
  identifier: "reference",
  clauseReference: "clause reference",
  documentReference: "document reference",
  partyName: "party name",
  suspectedEntity: "name",
};

/**
 * The whole tier rule, in one line.
 *
 * **`certain` decides, and nothing else.** A quantity is never certain — the
 * extractor cannot tell a count from a house number — so a bare number is always
 * a soft warning, which is what keeps `Clause 12` and `Item 7` from blocking a
 * restyle. A percentage or a currency *is* certain, because the symbol or the
 * sign makes it a claim about a measured quantity. An unrecognised identifier
 * is not certain either, so `MX4471` warns rather than refuses.
 */
function tierFor(fact: ProtectedFact): PreservationTier {
  return fact.certain ? "hard" : "soft";
}

function missingMessage(fact: ProtectedFact): string {
  return `The proposed revision removes a ${KIND_NAMES[fact.kind]} ("${fact.surface}") that was in the original.`;
}

function addedMessage(fact: ProtectedFact): string {
  return `The proposed revision introduces a ${KIND_NAMES[fact.kind]} ("${fact.surface}") that was not in the original.`;
}

function changedMessage(from: ProtectedFact, to: ProtectedFact): string {
  return `The proposed revision changes a ${KIND_NAMES[from.kind]}: "${from.surface}" becomes "${to.surface}".`;
}

/**
 * Pair a kind's unmatched originals against its unmatched proposals.
 *
 * **Positional, within one kind, and only when the counts agree.** `30 June
 * 2025` becoming `18 July 2025` is a change; one date becoming two dates is one
 * date missing and one added, because there is no way to know which of the two
 * is the original and reporting a pairing would be a guess presented as a
 * finding. Counts that differ are reported as `missing`/`added` for exactly that
 * reason — a report that invents a correspondence is worse than one that
 * reports less.
 */
function pairUnmatched(
  originals: readonly ProtectedFact[],
  proposals: readonly ProtectedFact[],
): { matched: FactChange[]; missing: ProtectedFact[]; added: ProtectedFact[] } {
  if (originals.length === proposals.length && originals.length > 0) {
    return {
      matched: originals.map((from, index) => {
        const to = proposals[index] as ProtectedFact;
        return {
          kind: from.kind,
          from,
          to,
          tier: tierFor(from),
          message: changedMessage(from, to),
        };
      }),
      missing: [],
      added: [],
    };
  }
  return {
    matched: [],
    missing: [...originals],
    added: [...proposals],
  };
}

function diffFacts(
  originalFacts: readonly ProtectedFact[],
  proposedFacts: readonly ProtectedFact[],
): {
  missing: ProtectedFact[];
  added: ProtectedFact[];
  changed: FactChange[];
} {
  const kinds: ProtectedFactKind[] = [
    ...new Set([...originalFacts, ...proposedFacts].map((fact) => fact.kind)),
  ];

  const missing: ProtectedFact[] = [];
  const added: ProtectedFact[] = [];
  const changed: FactChange[] = [];

  kinds.forEach((kind) => {
    const originals = originalFacts.filter((fact) => fact.kind === kind);
    const proposals = proposedFacts.filter((fact) => fact.kind === kind);

    /*
     * Exact matches cancel first, so a paragraph with six dates and one changed
     * reports one change rather than six.
     *
     * The proposals are the pool and the originals are the claimants: each
     * original either finds its value still in the pool and consumes it, or
     * stays unmatched. What survives on each side is what actually moved, and
     * `pairUnmatched` decides how to describe it.
     */
    const pool = [...proposals];
    const unmatchedOriginals = originals.filter((fact) => {
      const index = pool.findIndex((candidate) => candidate.value === fact.value);
      if (index === -1) return true;
      pool.splice(index, 1);
      return false;
    });

    const paired = pairUnmatched(unmatchedOriginals, pool);
    changed.push(...paired.matched);
    missing.push(...paired.missing);
    added.push(...paired.added);
  });

  return { missing, added, changed };
}

/**
 * Qualifiers and negations whose count differs between the two texts.
 *
 * **Both sides are scanned, not just the original.** A term the original does
 * not have and the proposal does is exactly the case the specification's §17
 * names first — "the local validator can detect addition/removal" — and an
 * implementation that only looked at the original would catch a hedge being
 * removed and miss one being added. `is recoverable` becoming `is not
 * recoverable` reverses the conclusion while every figure stays put.
 */
function diffQualifiers(original: string, proposed: string): PreservationWarning[] {
  const warnings: PreservationWarning[] = [];
  const occurrences = [...extractQualifiers(original), ...extractQualifiers(proposed)];

  const seen = new Set<string>();
  occurrences.forEach((occurrence) => {
    if (seen.has(occurrence.term)) return;
    seen.add(occurrence.term);

    const before = countTerm(original, occurrence.term);
    const after = countTerm(proposed, occurrence.term);
    if (before === after) return;
    const direction = after < before ? "removed" : "added";
    warnings.push({
      kind: occurrence.kind,
      term: occurrence.term,
      surface: occurrence.surface,
      tier: "soft",
      direction,
      message: qualifierMessage(occurrence.term, occurrence.kind, direction),
    });
  });

  return warnings;
}

/**
 * Compare an original and a proposed revision and decide whether the proposal
 * may be applied.
 *
 * Deterministic, offline, and total: it never throws for malformed input, because
 * a validator that can fail open is the failure mode it exists to prevent. Empty
 * text on either side produces an empty report rather than a refusal.
 */
export function validatePreservation(original: string, proposed: string): PreservationReport {
  const originalFacts = extractProtectedFacts(original);
  const proposedFacts = extractProtectedFacts(proposed);

  const { missing, added, changed } = diffFacts(originalFacts, proposedFacts);

  const hard: PreservationWarning[] = [
    ...missing
      .filter((fact) => tierFor(fact) === "hard")
      .map((fact) => ({
        kind: fact.kind,
        term: fact.surface,
        surface: fact.surface,
        tier: "hard" as const,
        direction: "removed" as const,
        message: missingMessage(fact),
      })),
    ...added
      .filter((fact) => tierFor(fact) === "hard")
      .map((fact) => ({
        kind: fact.kind,
        term: fact.surface,
        surface: fact.surface,
        tier: "hard" as const,
        direction: "added" as const,
        message: addedMessage(fact),
      })),
  ];

  const soft: PreservationWarning[] = [
    ...missing
      .filter((fact) => tierFor(fact) === "soft")
      .map((fact) => ({
        kind: fact.kind,
        term: fact.surface,
        surface: fact.surface,
        tier: "soft" as const,
        direction: "removed" as const,
        message: missingMessage(fact),
      })),
    ...added
      .filter((fact) => tierFor(fact) === "soft")
      .map((fact) => ({
        kind: fact.kind,
        term: fact.surface,
        surface: fact.surface,
        tier: "soft" as const,
        direction: "added" as const,
        message: addedMessage(fact),
      })),
    ...diffQualifiers(original, proposed),
  ];

  // A hard *change* is a hard failure and has to appear in `warnings` like any
  // other, or the report refuses the revision while listing nothing to fix.
  const changeWarnings = changed.map((change) => ({
    kind: change.kind,
    term: change.from.surface,
    surface: change.from.surface,
    tier: change.tier,
    direction: "added" as const,
    message: change.message,
  }));

  const warnings = [...hard, ...soft, ...changeWarnings];
  const pass = changed.every((change) => change.tier === "soft") && hard.length === 0;

  return {
    pass,
    requiresAcknowledgement: pass && warnings.length > 0,
    originalFacts,
    proposedFacts,
    missing,
    added,
    changed,
    warnings,
    summary: pass
      ? ""
      : "ToneForge detected a factual difference in the proposed revision. This proposal cannot be applied as a style-only revision.",
  };
}

/** Every protected token the specification's §16.1 hard tier covers, by name. */
export const HARD_TIER_KINDS: readonly ProtectedFactKind[] = [
  "date",
  "duration",
  "percentage",
  "currency",
  "activityIdentifier",
  "eventIdentifier",
  "identifier",
  "clauseReference",
  "documentReference",
  "partyName",
];

export { QUALIFIER_TERMS, NEGATION_TERMS };
