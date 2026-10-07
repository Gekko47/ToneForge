/**
 * Claim normalisation (original §8).
 *
 * The deterministic data-prep stage: every claim the evidence
 * validator accepted is normalised once, so the indices and the
 * retrievers downstream compare canonical forms rather than the
 * raw text the document happened to use.
 *
 * Normalisation fills what the extraction pass left as text and
 * leaves unknown what the document did not settle. It never
 * invents a facet: a date that does not parse stays raw and
 * unkeyed, a value that does not parse stays unkeyed, and both
 * are simply not indexed.
 */

import type { AliasEntry } from "./aliases";
import { partyAliases } from "./aliases";
import { normaliseDate } from "./dates";
import { normaliseValue, parseDurationDays } from "./quantities";
import type { ClaimValue, DateValue, ExpertReportClaim } from "../contracts";

export { buildAliasIndex, partyAliases } from "./aliases";
export type { AliasEntry, AliasIndex } from "./aliases";
export { normaliseDate, dateKey, dateRangeKey } from "./dates";
export {
  baseUnit,
  compatibleUnits,
  currencyCode,
  normaliseValue,
  parseDecimal,
  parseDurationDays,
  quantityKey,
  toBaseUnit,
  unitDimension,
} from "./quantities";

/**
 * The temporal roles a claim carries dates under. Each role is
 * kept apart: an assertion date is not interchangeable with an
 * event date, and collapsing them is how a forecast-vs-actual
 * contradiction hides.
 */
const TEMPORAL_ROLES = [
  "assertionDate",
  "eventDate",
  "effectiveDate",
  "reportingDate",
  "dataDate",
  "forecastDate",
  "baselineDate",
  "periodStart",
  "periodEnd",
] as const;

/** One date a claim carries, with the role it plays. */
export interface NormalisedDate {
  readonly role: string;
  readonly date: DateValue;
}

/** A claim with every facet the engine compares normalised. */
export interface NormalisedClaim {
  readonly claim: ExpertReportClaim;
  /** Every asserted value, parsed and keyed. */
  readonly values: readonly ClaimValue[];
  /** Every date, parsed and keyed, with its role. */
  readonly dates: readonly NormalisedDate[];
  /** The claim's delay duration in days, when it states one. */
  readonly durationDays: number | null;
}

/**
 * Normalise every claim: parse what the extraction left as raw
 * text, and leave unknown what the document did not settle.
 */
export function normaliseClaims(claims: readonly ExpertReportClaim[]): NormalisedClaim[] {
  return claims.map((claim) => {
    const values = claim.values.map(normaliseValue);
    const dates: NormalisedDate[] = [];
    TEMPORAL_ROLES.forEach((role) => {
      const date = claim.temporal[role];
      if (date !== undefined) {
        dates.push({ role, date: normaliseDate(date) });
      }
    });
    const durationDays =
      claim.delay?.durationDays ??
      (claim.delay?.durationText === undefined
        ? null
        : parseDurationDays(claim.delay.durationText));
    return { claim, values, dates, durationDays };
  });
}

/**
 * The alias entries a claim set contributes: every party the
 * claims name — speaker, attributed party, scenario owner,
 * responsible party — under its name.
 */
export function collectAliasEntries(claims: readonly ExpertReportClaim[]): AliasEntry[] {
  const entries: AliasEntry[] = [];
  claims.forEach((claim) => {
    entries.push(...partyAliases(claim.speaker));
    if (claim.attributedTo !== undefined) {
      entries.push(...partyAliases(claim.attributedTo));
    }
    if (claim.scenario?.owner !== undefined) {
      entries.push(...partyAliases(claim.scenario.owner));
    }
    if (claim.responsibility?.party !== undefined) {
      entries.push(...partyAliases(claim.responsibility.party));
    }
  });
  return entries;
}
