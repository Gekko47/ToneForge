/**
 * Bulk-add for preferred terminology — paste `term: replacement` lines.
 *
 * **Why this exists.** The profile editor had two editors for
 * `language.terminology`: a row per rule, and a `term: replacement` textarea in
 * a second panel. Two owners for one field is the ND-2 defect in the UI, and the
 * textarea is the lossy one — it cannot carry `severity`, `caseSensitive`,
 * `wholeWord` or `scope`. Removing it (stage S4) is only safe if the row editor
 * can accept a paste first, which is what this is.
 *
 * **A disclosure, not a second visible field.** Forty terminology rules would
 * bury a permanently-open paste box in a 329px pane, and the paste is a
 * one-off — once applied, the box has done its job and the rules are rows.
 *
 * **Reuses the shared parser.** [`parseTerminology`](../settings/terminologyText.ts)
 * is already the single implementation of this format, extracted precisely so a
 * second one could not appear. This component ships a third format nowhere; it
 * reads through the same function the deleted textarea did, so the errors a user
 * sees here are the errors they were getting before.
 *
 * **The count is stated before anything is written.** `planBulkTerms` is pure and
 * runs on every keystroke, so the summary describes what *would* happen. A paste
 * of two hundred lines is something a user should agree to, not discover.
 */

import React from "react";

import { buildBulkRules, planBulkTerms, type BulkTermOutcome } from "../terminologyRows";
import { parseTerminology, TERMINOLOGY_NOUNS } from "../settings/terminologyText";
import type { TerminologyRule } from "../../core/domain/StyleProfile";

export interface TerminologyBulkAddProps {
  /** The rules currently in the profile. */
  existing: readonly TerminologyRule[];
  /** Called once, with every rule the paste calls for. */
  onAdd: (rules: TerminologyRule[]) => void;
  /** Names the disclosure, so the heading is a usable accessible name. */
  id: string;
}

/** How one skipped pair is described, in the user's terms. */
function reasonFor(entry: BulkTermOutcome): string {
  if (entry.outcome === "already-present") return "already in the list";
  if (entry.outcome === "within-paste") {
    return entry.source.length === 0 ? "blank" : "repeated in this paste";
  }
  return "";
}

/**
 * The sentences below the box.
 *
 * Every count is stated even when it is zero, and the "nothing would be added"
 * case gets its own sentence — a bare "0 added" next to an enabled button is a
 * control that looks live and does nothing.
 */
function summary(added: number, skipped: readonly BulkTermOutcome[]): string {
  const parts: string[] = [];
  parts.push(added === 1 ? "1 term would be added." : `${added} terms would be added.`);
  const present = skipped.filter((entry) => entry.outcome === "already-present").length;
  const within = skipped.length - present;
  if (present > 0) {
    parts.push(
      present === 1
        ? "1 is already in the list and will be left alone."
        : `${present} are already in the list and will be left alone.`,
    );
  }
  if (within > 0) {
    parts.push(
      within === 1
        ? "1 line was skipped as unusable."
        : `${within} lines were skipped as unusable.`,
    );
  }
  return parts.join(" ");
}

export default function TerminologyBulkAdd({
  existing,
  onAdd,
  id,
}: TerminologyBulkAddProps): React.ReactNode {
  const [pasted, setPasted] = React.useState("");
  const parse = parseTerminology(pasted);
  const plan = React.useMemo(() => planBulkTerms(parse.values, existing), [parse.values, existing]);
  const canApply = plan.added.length > 0;

  function apply(): void {
    if (!canApply) return;
    onAdd(buildBulkRules(plan, existing));
    // Cleared rather than kept: the rules are now rows, and leaving the text
    // would invite the user to press Apply twice and wonder why nothing moved.
    setPasted("");
  }

  return (
    <details className="tf-bulk-add">
      <summary className="tf-bulk-add-summary">Add many terms</summary>
      <div className="tf-bulk-add-body">
        <label className="tf-field">
          <span id={`${id}-label`}>Paste terms, one per line</span>
          <textarea
            className="tf-native"
            rows={4}
            aria-describedby={`${id}-hint ${id}-summary`}
            placeholder={`colour: color\nprioritise: prioritize`}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
          />
        </label>
        <p className="tf-sub" id={`${id}-hint`}>
          {`One "${TERMINOLOGY_NOUNS.left}: ${TERMINOLOGY_NOUNS.right}" per line. Each becomes a row you can edit afterwards, with the same settings the Add preferred term button uses. A term containing a colon must be added as a row.`}
        </p>
        {/*
         * `role="status"` rather than a plain paragraph: this sentence changes
         * as the user types, and a screen-reader user needs to hear that without
         * having to go looking for it. Polite so it never interrupts.
         */}
        <p className="tf-sub" id={`${id}-summary`} role="status">
          {parse.error !== null
            ? parse.error
            : pasted.trim().length === 0
              ? "Paste some lines to see what they would add."
              : summary(plan.added.length, plan.skipped)}
        </p>
        {plan.skipped.length > 0 && (
          <ul className="tf-bulk-add-skipped" aria-label="Lines that would be skipped">
            {plan.skipped.map((entry, index) => (
              <li key={`${entry.source}-${index}`}>
                <code>{entry.source.length === 0 ? "(blank line)" : entry.source}</code> —{" "}
                {reasonFor(entry)}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="tf-native-button"
          onClick={apply}
          disabled={!canApply || parse.error !== null}
        >
          {plan.added.length === 1 ? "Add 1 term" : `Add ${plan.added.length} terms`}
        </button>
      </div>
    </details>
  );
}
