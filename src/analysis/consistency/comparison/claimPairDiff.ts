/**
 * ClaimPairDiff (R4, original §11).
 *
 * The deterministic diff between two claims that share a subject.
 * System One must not rediscover this from prose — the resolver
 * produces it once, and the decision model receives it as structured
 * fact.
 */

import type { ExpertReportClaim, ClaimValue, DateValue } from "../contracts";
import { attributionKey, compareDates } from "../checks/primitives";
import { compatibleUnits, toBaseUnit } from "../normalisation";

/** One field the two claims agree on. */
export interface ClaimFieldMatch {
  readonly field: string;
  readonly value: string;
}

/** One field the two claims disagree on. */
export interface ClaimFieldDifference {
  readonly field: string;
  readonly left: string;
  readonly right: string;
}

/** One field where at least one claim has no value. */
export interface ClaimFieldUnknown {
  readonly field: string;
  readonly reason: string;
}

/** The complete diff between two claims. */
export interface ClaimPairDiff {
  readonly matches: readonly ClaimFieldMatch[];
  readonly differences: readonly ClaimFieldDifference[];
  readonly unknowns: readonly ClaimFieldUnknown[];
}

/**
 * Build the diff between two claims that share a subject.
 *
 * The claims are already known to be about the same subject (same
 * entity, event, term, reference, section, or quantum). The diff
 * compares every facet the engine knows about and classifies each
 * as a match, a difference, or an unknown.
 */
export function buildClaimPairDiff(
  left: ExpertReportClaim,
  right: ExpertReportClaim,
): ClaimPairDiff {
  const matches: ClaimFieldMatch[] = [];
  const differences: ClaimFieldDifference[] = [];
  const unknowns: ClaimFieldUnknown[] = [];

  // Entity IDs
  const leftEntityIds = new Set(left.subjectIds);
  const rightEntityIds = new Set(right.subjectIds);
  const sharedEntityIds = [...leftEntityIds].filter((id) => rightEntityIds.has(id));
  if (sharedEntityIds.length > 0) {
    matches.push({ field: "entity", value: sharedEntityIds.join(", ") });
  } else if (leftEntityIds.size > 0 && rightEntityIds.size > 0) {
    differences.push({
      field: "entity",
      left: [...leftEntityIds].join(", "),
      right: [...rightEntityIds].join(", "),
    });
  } else {
    unknowns.push({ field: "entity", reason: "one or both claims lack entity IDs" });
  }

  // Event IDs
  const leftEventIds = new Set(left.eventIds);
  const rightEventIds = new Set(right.eventIds);
  const sharedEventIds = [...leftEventIds].filter((id) => rightEventIds.has(id));
  if (sharedEventIds.length > 0) {
    matches.push({ field: "event", value: sharedEventIds.join(", ") });
  } else if (leftEventIds.size > 0 && rightEventIds.size > 0) {
    differences.push({
      field: "event",
      left: [...leftEventIds].join(", "),
      right: [...rightEventIds].join(", "),
    });
  } else {
    unknowns.push({ field: "event", reason: "one or both claims lack event IDs" });
  }

  // Programme IDs
  const leftProgrammeIds = new Set(left.programmeIds);
  const rightProgrammeIds = new Set(right.programmeIds);
  const sharedProgrammeIds = [...leftProgrammeIds].filter((id) => rightProgrammeIds.has(id));
  if (sharedProgrammeIds.length > 0) {
    matches.push({ field: "programme", value: sharedProgrammeIds.join(", ") });
  } else if (leftProgrammeIds.size > 0 && rightProgrammeIds.size > 0) {
    differences.push({
      field: "programme",
      left: [...leftProgrammeIds].join(", "),
      right: [...rightProgrammeIds].join(", "),
    });
  } else {
    unknowns.push({ field: "programme", reason: "one or both claims lack programme IDs" });
  }

  // Scenario
  const leftScenario = left.scenario?.type ?? "unknown";
  const rightScenario = right.scenario?.type ?? "unknown";
  if (leftScenario !== "unknown" && rightScenario !== "unknown") {
    if (leftScenario === rightScenario) {
      matches.push({ field: "scenario", value: leftScenario });
    } else {
      differences.push({ field: "scenario", left: leftScenario, right: rightScenario });
    }
  } else {
    unknowns.push({ field: "scenario", reason: "one or both claims lack scenario type" });
  }

  // Period (temporal: periodStart/periodEnd)
  const leftPeriod = periodKey(left.temporal);
  const rightPeriod = periodKey(right.temporal);
  if (leftPeriod !== null && rightPeriod !== null) {
    if (leftPeriod === rightPeriod) {
      matches.push({ field: "period", value: leftPeriod });
    } else {
      differences.push({ field: "period", left: leftPeriod, right: rightPeriod });
    }
  } else {
    unknowns.push({ field: "period", reason: "one or both claims lack period dates" });
  }

  // Unit (from values)
  const leftUnits = new Set(left.values.map((v) => v.unit ?? "").filter((u) => u.length > 0));
  const rightUnits = new Set(right.values.map((v) => v.unit ?? "").filter((u) => u.length > 0));
  const sharedUnits = [...leftUnits].filter((u) => rightUnits.has(u));
  if (sharedUnits.length > 0) {
    matches.push({ field: "unit", value: sharedUnits.join(", ") });
  } else if (leftUnits.size > 0 && rightUnits.size > 0) {
    differences.push({
      field: "unit",
      left: [...leftUnits].join(", "),
      right: [...rightUnits].join(", "),
    });
  } else {
    unknowns.push({ field: "unit", reason: "one or both claims lack units" });
  }

  // Value (normalised numeric comparison)
  const leftValues = left.values.filter(
    (v): v is typeof v & { normalized: number } => v.normalized !== undefined,
  );
  const rightValues = right.values.filter(
    (v): v is typeof v & { normalized: number } => v.normalized !== undefined,
  );
  if (leftValues.length > 0 && rightValues.length > 0) {
    // Compare first normalised value from each (C2 retrieves by metric, so one metric per candidate)
    const lv = leftValues[0]!.normalized;
    const rv = rightValues[0]!.normalized;
    if (lv === rv) {
      matches.push({ field: "value", value: String(lv) });
    } else {
      differences.push({ field: "value", left: String(lv), right: String(rv) });
    }
  } else {
    unknowns.push({ field: "value", reason: "one or both claims lack normalised values" });
  }

  // Scope
  const leftScope = left.scope.kind;
  const rightScope = right.scope.kind;
  if (leftScope !== "unknown" && rightScope !== "unknown") {
    if (leftScope === rightScope) {
      matches.push({ field: "scope", value: leftScope });
    } else {
      differences.push({ field: "scope", left: leftScope, right: rightScope });
    }
  } else {
    unknowns.push({ field: "scope", reason: "one or both claims lack scope kind" });
  }

  // Basis (contractual basis references)
  const leftBasis = left.contractualBasis?.map((b) => b.reference).join(", ") ?? "";
  const rightBasis = right.contractualBasis?.map((b) => b.reference).join(", ") ?? "";
  if (leftBasis && rightBasis) {
    if (leftBasis === rightBasis) {
      matches.push({ field: "basis", value: leftBasis });
    } else {
      differences.push({ field: "basis", left: leftBasis, right: rightBasis });
    }
  } else {
    unknowns.push({ field: "basis", reason: "one or both claims lack contractual basis" });
  }

  // Attribution (speaker + attributedTo)
  const leftAttribution = attributionKey(left);
  const rightAttribution = attributionKey(right);
  if (leftAttribution && rightAttribution) {
    if (leftAttribution === rightAttribution) {
      matches.push({ field: "attribution", value: leftAttribution });
    } else {
      differences.push({ field: "attribution", left: leftAttribution, right: rightAttribution });
    }
  } else {
    unknowns.push({ field: "attribution", reason: "one or both claims lack attribution" });
  }

  // Qualifiers
  const leftQualifiers = left.qualifiers.map((q) => q.text).join("; ");
  const rightQualifiers = right.qualifiers.map((q) => q.text).join("; ");
  if (leftQualifiers && rightQualifiers) {
    if (leftQualifiers === rightQualifiers) {
      matches.push({ field: "qualifiers", value: leftQualifiers });
    } else {
      differences.push({ field: "qualifiers", left: leftQualifiers, right: rightQualifiers });
    }
  } else {
    unknowns.push({ field: "qualifiers", reason: "one or both claims lack qualifiers" });
  }

  // Update relationship (adoption status)
  const leftAdoption = left.adoptionStatus;
  const rightAdoption = right.adoptionStatus;
  if (leftAdoption !== "unknown" && rightAdoption !== "unknown") {
    if (leftAdoption === rightAdoption) {
      matches.push({ field: "updateRelationship", value: leftAdoption });
    } else {
      differences.push({ field: "updateRelationship", left: leftAdoption, right: rightAdoption });
    }
  } else {
    unknowns.push({
      field: "updateRelationship",
      reason: "one or both claims have unknown adoption",
    });
  }

  return { matches, differences, unknowns };
}

/** Build a period key from temporal context, or null if missing. */
function periodKey(temporal: ExpertReportClaim["temporal"]): string | null {
  const start = temporal.periodStart?.iso ?? temporal.periodStart?.raw;
  const end = temporal.periodEnd?.iso ?? temporal.periodEnd?.raw;
  if (start && end) return `${start}..${end}`;
  if (start) return `${start}..`;
  if (end) return `..${end}`;
  return null;
}

/**
 * Compare two values with unit conversion (C6).
 * Returns "same" | "differs" | "incomparable" | "unrelated".
 */
export function compareValues(
  left: ClaimValue,
  right: ClaimValue,
): "same" | "differs" | "incomparable" | "unrelated" {
  if (left.normalized === undefined || right.normalized === undefined) {
    return "unrelated";
  }
  const leftCurrency = left.currency ?? "";
  const rightCurrency = right.currency ?? "";
  if (leftCurrency !== "" && rightCurrency !== "" && leftCurrency !== rightCurrency) {
    return "incomparable";
  }
  const leftUnit = left.unit ?? "";
  const rightUnit = right.unit ?? "";
  if (!compatibleUnits(leftUnit, rightUnit)) {
    return "incomparable";
  }
  const leftBase = toBaseUnit(left.normalized, leftUnit);
  const rightBase = toBaseUnit(right.normalized, rightUnit);
  if (leftBase === null || rightBase === null) {
    return "incomparable";
  }
  return leftBase === rightBase ? "same" : "differs";
}

/**
 * Compare two dates with role awareness (C3).
 * Returns "same" | "conflict" | "incomparable".
 */
export function compareDatesByRole(
  left: DateValue,
  right: DateValue,
): "same" | "conflict" | "incomparable" {
  // Reuse the primitives compareDates which handles coarse vs precise
  const leftMatch = {
    iso: left.iso ?? "",
    raw: left.raw,
    year: left.year ?? 0,
    month: left.month ?? 0,
    day: left.day ?? 0,
  };
  const rightMatch = {
    iso: right.iso ?? "",
    raw: right.raw,
    year: right.year ?? 0,
    month: right.month ?? 0,
    day: right.day ?? 0,
  };
  return compareDates(leftMatch, rightMatch);
}
