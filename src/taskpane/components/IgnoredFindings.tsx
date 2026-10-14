/**
 * The ignore list, at the bottom of Deterministic Review.
 *
 * A finding the user set aside has not been resolved, only stopped being
 * shown. Hiding that list made the ignore action irreversible from the UI and
 * left the summary quietly counting a document as clean when it was not, so
 * the list is permanent, not a transient toast, and every row can be restored.
 *
 * Collapsible, and collapsed when empty. It renders nothing at all in that case
 * rather than an empty header: a section that is always present and always empty
 * is the same noise this list was built to remove.
 *
 * The entries are stored, not recomputed: after a rescan the finding that was
 * ignored may not reappear at all (it was fixed, or it moved out of the
 * examined scope), and an ignore list rebuilt from the current findings would
 * silently drop those. Persisting what was ignored, keyed by fingerprint, is
 * what makes the action survive a scan that did not re-derive it.
 *
 * The list uses the same type-button structure as the live findings, so both
 * surfaces render identically. Pressing a type row opens the overlay for the
 * ignored findings of that type, where the action is Restore.
 */

import React from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import type { Finding, IgnoredFinding } from "../../core/domain/Finding";
import { iconForCategory, type FindingTypeGroup } from "../findingsByType";
import { DisclosurePanel } from "./common";
import FindingTypeList from "./FindingTypeList";
import FindingDetailOverlay from "./FindingDetailOverlay";

const useStyles = makeStyles({
  root: {
    marginTop: tokens.spacingVerticalM,
  },
});

export interface IgnoredFindingsProps {
  entries: readonly IgnoredFinding[];
  /**
   * Restore one occurrence, by its occurrence key.
   *
   * Not the fingerprint. A fingerprint identifies a *rule*, so restoring by it
   * removed every ignored row of that rule at once — the button said "Restore"
   * and the list lost entries the user never asked about. Two hits of one rule
   * are two rows, and each restores itself.
   */
  onRestore: (occurrence: string) => void;
}

/**
 * Convert a stored IgnoredFinding to the minimal Finding the overlay needs.
 *
 * The overlay renders FindingDetail, which expects a Finding. An IgnoredFinding
 * stores only what the list needs to render and to offer Restore — not the full
 * Finding shape. This builds the minimum: id from findingId, kind deterministic,
 * status ignored, actionable false (it is already ignored).
 */
function ignoredToFinding(entry: IgnoredFinding): Finding {
  return {
    id: entry.findingId,
    kind: "deterministic",
    category: entry.category,
    range: entry.range,
    message: entry.message,
    severity: "warning",
    evidence: "",
    nodeIds: entry.nodeIds,
    source: "deterministic",
    risk: "none",
    reversible: true,
    status: "ignored",
    confidence: 1,
    actionable: false,
  };
}

/**
 * Group ignored entries by category into FindingTypeGroup rows.
 *
 * IgnoredFinding has no ruleId, so grouping is by category — the same fallback
 * the live findings projection uses when ruleId is absent.
 */
function groupIgnoredByType(entries: readonly IgnoredFinding[]): FindingTypeGroup[] {
  const byKey = new Map<string, FindingTypeGroup>();
  const order: string[] = [];

  entries.forEach((entry) => {
    const key = entry.category;
    const existing = byKey.get(key);
    const finding = ignoredToFinding(entry);
    if (existing !== undefined) {
      existing.count += 1;
      existing.findings.push(finding);
      return;
    }
    const domain = entry.category.startsWith("typography.")
      ? "Typography"
      : entry.category.startsWith("language.")
        ? "Language"
        : entry.category.startsWith("formatting.")
          ? "Document formatting"
          : entry.category.startsWith("houseStyle.")
            ? "House style"
            : "Style";
    const group: FindingTypeGroup = {
      key,
      label: entry.category,
      ruleName: entry.category.split(".").pop() ?? entry.category,
      parent: domain,
      icon: iconForCategory(entry.category),
      count: 1,
      findings: [finding],
    };
    byKey.set(key, group);
    order.push(key);
  });

  return order
    .map((key) => byKey.get(key))
    .filter((group): group is FindingTypeGroup => group !== undefined)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

export default function IgnoredFindings({
  entries,
  onRestore,
}: IgnoredFindingsProps): React.ReactNode {
  const styles = useStyles();
  const [open, setOpen] = React.useState(false);
  const [selectedGroup, setSelectedGroup] = React.useState<FindingTypeGroup | null>(null);
  const [position, setPosition] = React.useState(0);

  if (entries.length === 0) return null;

  const groups = groupIgnoredByType(entries);
  const currentFinding = selectedGroup?.findings[position] ?? null;
  const remaining = selectedGroup?.findings.length ?? 0;

  const handleSelect = (group: FindingTypeGroup): void => {
    setSelectedGroup(group);
    setPosition(0);
  };

  const handleClose = (): void => {
    setSelectedGroup(null);
    setPosition(0);
  };

  const handlePrevious = (): void => {
    setPosition((prev) => Math.max(0, prev - 1));
  };

  const handleNext = (): void => {
    setPosition((prev) => Math.min(remaining - 1, prev + 1));
  };

  const handleRestore = (finding: Finding): void => {
    const entry = entries.find((e) => e.findingId === finding.id);
    if (!entry) return;
    const occurrence = entry.occurrenceKey.length > 0 ? entry.occurrenceKey : entry.fingerprint;
    onRestore(occurrence);
    // Advance to the next ignored finding of this type, or close if none remain.
    const nextPosition = position + 1;
    if (nextPosition < remaining - 1) {
      setPosition(nextPosition);
    } else {
      handleClose();
    }
  };

  return (
    <div className={styles.root}>
      <DisclosurePanel
        title={
          <>
            Ignored findings <span>{entries.length}</span>
          </>
        }
        ariaLabel="Ignored findings section"
        open={open}
        onToggle={setOpen}
      >
        {open && (
          <>
            <p className="tf-sub">
              These findings were set aside, not fixed. They are excluded from the open count and
              will keep being re-detected until the underlying text changes.
            </p>
            <FindingTypeList
              groups={groups}
              onSelect={handleSelect}
              ariaLabelPrefix="Open ignored findings for"
            />
          </>
        )}
      </DisclosurePanel>
      <FindingDetailOverlay
        group={selectedGroup}
        finding={currentFinding}
        remaining={remaining}
        total={remaining}
        position={position + 1}
        acceptDisabled={false}
        onClose={handleClose}
        onPrevious={handlePrevious}
        onNext={handleNext}
        onAccept={() => {}}
        onAcceptAll={() => {}}
        onSkip={() => {}}
        onIgnore={() => {}}
        onRestore={handleRestore}
        isIgnored
      />
    </div>
  );
}
