/** Evidence tiers for a Word capability. Mirrors docs/manual-verification.md. */
export type CapabilityEvidenceTier = "api-present" | "host-tested" | "release-supported";

export interface CapabilityEvidence {
  capability: string;
  apiPresent: boolean;
  hostTested: boolean;
  releaseSupported: boolean;
  tier: CapabilityEvidenceTier | "unsupported";
  detail: string;
}

export interface EvidenceInput {
  capability: string;
  apiPresent: boolean;
  hostTested: boolean;
  releaseSupported: boolean;
  detail?: string;
}

export function assessCapabilityEvidence(input: EvidenceInput): CapabilityEvidence {
  const tier: CapabilityEvidence["tier"] = !input.apiPresent
    ? "unsupported"
    : input.releaseSupported
      ? "release-supported"
      : input.hostTested
        ? "host-tested"
        : "api-present";
  return {
    capability: input.capability,
    apiPresent: input.apiPresent,
    hostTested: input.hostTested,
    releaseSupported: input.releaseSupported,
    tier,
    detail:
      input.detail ??
      (tier === "unsupported"
        ? "The API is not present on this host."
        : tier === "api-present"
          ? "The API is present but not yet verified in a host."
          : tier === "host-tested"
            ? "Verified in at least one host; not a release commitment yet."
            : "Verified and part of the supported-host release matrix."),
  };
}

/** Word paragraph events require WordApi 1.6. */
export const PARAGRAPH_EVENT_MIN_REQUIREMENT_SET = "1.6";

export function compareRequirementSets(actual: string, minimum: string): number {
  const parse = (value: string): number[] =>
    value
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isNaN(part) ? 0 : part));
  const left = parse(actual);
  const right = parse(minimum);
  const length = Math.max(left.length, right.length);
  const differences = Array.from(
    { length },
    (_value, index) => (left[index] ?? 0) - (right[index] ?? 0),
  );
  return differences.find((difference) => difference !== 0) ?? 0;
}

export function paragraphEventRequirementMet(actual: string | null): boolean {
  return (
    actual !== null && compareRequirementSets(actual, PARAGRAPH_EVENT_MIN_REQUIREMENT_SET) >= 0
  );
}
