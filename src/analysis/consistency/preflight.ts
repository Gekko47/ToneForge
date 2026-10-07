/**
 * Preflight (R7, original §32).
 *
 * What the user is shown before a run starts, measured from the document
 * rather than guessed. The counts are the ones the run will actually use:
 * `previewStatements` is the same splitter the engine segments with, so the
 * preflight counts the document that will be reviewed, not a different one.
 *
 * The redaction list is explicit. When the run has not opted out of redaction,
 * the list names what is withheld; when it has, the list says so plainly. A
 * user cannot consent to sending text they were not told would be sent.
 */

import { previewStatements } from "./indexedEngine";
import { CONSISTENCY_STORE_TTL_DAYS } from "./persistence/audit";

export interface ConsistencyPreflight {
  /** Words the extraction pass will process. */
  readonly approximateWords: number;
  /** Statements the run will segment. */
  readonly statementCount: number;
  /** The per-subject cap the run will honour. */
  readonly maxPerSubject: number;
  /** The decision-model budget the run will honour. */
  readonly maxAdjudications: number;
  /** True when exact statement text will be sent to the provider. */
  readonly allowUnredacted: boolean;
  /** What is withheld from the provider, or a statement that nothing is. */
  readonly redactionList: readonly string[];
  /** The storage line, in the user's terms. */
  readonly storageNote: string;
}

export interface PreflightInput {
  readonly text: string;
  readonly maxPerSubject: number;
  readonly maxAdjudications: number;
  readonly allowUnredacted: boolean;
}

/** The fields redaction strips before text leaves the add-in. */
const REDACTED_FIELDS = [
  "Party names and other named entities",
  "Monetary amounts and quantities",
  "Dates and periods",
  "Quoted source text",
] as const;

/**
 * What is withheld for a given opt-out state.
 *
 * The single source of truth for the redaction list, shared by `buildPreflight`
 * and the preflight UI's per-run toggle so the two can never disagree about
 * what a run will send. With the opt-out, nothing is withheld and the list says
 * so; without it, the list names the fields that are stripped.
 */
export function redactionListFor(allowUnredacted: boolean): readonly string[] {
  return allowUnredacted
    ? ["Nothing is withheld: this run sends exact statement text to the provider."]
    : REDACTED_FIELDS;
}

/**
 * Measure the document and describe what the run will do.
 *
 * The redaction list is the honest one: with the opt-out, nothing is withheld
 * and the list says so; without it, the list names the fields that are
 * stripped. Either way the user is told which of the two runs they are
 * starting.
 */
export function buildPreflight(input: PreflightInput): ConsistencyPreflight {
  const approximateWords = input.text.split(/\s+/).filter((word) => word.length > 0).length;
  return {
    approximateWords,
    statementCount: previewStatements(input.text).length,
    maxPerSubject: input.maxPerSubject,
    maxAdjudications: input.maxAdjudications,
    allowUnredacted: input.allowUnredacted,
    redactionList: redactionListFor(input.allowUnredacted),
    storageNote: `Temporary on this device · ${CONSISTENCY_STORE_TTL_DAYS} days`,
  };
}
