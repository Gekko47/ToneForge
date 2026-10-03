/**
 * The coverage verdict — the one compliance claim the pane is allowed to make.
 *
 * **Why this is not derivable from coverage alone.** `DeterministicCoverage`
 * answers "what did this run examine". It cannot answer "is the document
 * compliant", because compliance needs the findings as well, and nothing in the
 * coverage record knows whether anything was found. Deriving "compliant" from
 * `complete` alone would have been the false-compliance claim the whole coverage
 * model exists to prevent: a run that examined every requested scope and found
 * two hundred spacing errors is `complete`, and reading "Complete" as "no
 * problems" is the misreading the audit is about.
 *
 * So the verdict takes both, and there are four:
 *
 * - `unknown` — only the shared report arrived. It carries no
 *   requested-versus-examined list, so no compliance claim is available at all.
 * - `incomplete` — something the author made mandatory was not examined.
 * - `compliant` — everything requested was examined and nothing is open.
 * - `findings-open` — everything requested was examined, and there is work to do.
 *
 * **The phrase "within checked scope" is load-bearing and stays in the string.**
 * A document checked only for body text is compliant within the scopes it asked
 * about, and says nothing about the tables it never looked at. "Compliant" alone
 * would be the over-claim this whole model was built to refuse.
 *
 * Pure: no React, no Office, no storage. Every verdict the banner can show is
 * reachable from a test with no host.
 */

import type { DeterministicCoverage } from "../analysis/deterministic/contracts";

export type CoverageVerdict = "unknown" | "incomplete" | "compliant" | "findings-open";

export interface CoverageVerdictInput {
  /** The deterministic projection, or null when only the shared report exists. */
  coverage: DeterministicCoverage | null;
  /**
   * Findings the user has not decided.
   *
   * The *open* ones, not every finding. A user who has approved or skipped an
   * occurrence has dealt with it, and counting it would leave "compliant" showing
   * on a document whose work is sitting in Pending Changes — the one state where
   * that word would be most misleading.
   */
  openFindings: number;
}

/**
 * Decide the verdict.
 *
 * `unknown` is checked first and is not merely a fallback: a caller holding only
 * the shared report must be told no claim is available rather than being given a
 * weaker one.
 */
export function coverageVerdict(input: CoverageVerdictInput): CoverageVerdict {
  if (input.coverage === null) return "unknown";
  if (!input.coverage.complete) return "incomplete";
  return input.openFindings === 0 ? "compliant" : "findings-open";
}

/** The verdict as the banner header prints it. */
export function verdictLabel(verdict: CoverageVerdict): string {
  switch (verdict) {
    case "unknown":
      return "Unknown";
    case "incomplete":
      return "Incomplete";
    case "compliant":
      return "Compliant within checked scope";
    case "findings-open":
      return "Checked — findings open";
  }
}

/**
 * The sentence under the header, saying what the verdict does and does not cover.
 *
 * Every branch names its own limit. A verdict line that explains only the good
 * case teaches the reader that the word means "the document is fine", which is
 * the reading this module exists to prevent.
 */
export function verdictDetail(verdict: CoverageVerdict, input: CoverageVerdictInput): string {
  const coverage = input.coverage;
  const examined = coverage === null ? [] : coverage.examinedScopes;
  const scope = examined.length === 0 ? "nothing" : listOf(examined);
  switch (verdict) {
    case "unknown":
      return (
        "This pane cannot say how much of the document was checked. Re-scan with a " +
        "deterministic style profile to get a coverage verdict."
      );
    case "incomplete":
      return (
        "At least one scope the profile made mandatory was not examined, so this run " +
        `cannot speak for the document. What was examined: ${scope}.`
      );
    case "compliant":
      return (
        `Every scope the profile asked for was examined (${scope}) and nothing is open. ` +
        "Scopes the profile did not ask for, and anything this host cannot read, were " +
        "not checked."
      );
    case "findings-open":
      return (
        `Every scope the profile asked for was examined (${scope}). ` +
        `${input.openFindings} finding${input.openFindings === 1 ? " is" : "s are"} still open. ` +
        "Scopes the profile did not ask for were not checked."
      );
  }
}

function listOf(scopes: readonly string[]): string {
  return scopes.join(", ");
}
