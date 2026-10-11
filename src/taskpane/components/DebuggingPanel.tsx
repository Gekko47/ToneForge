import React, { useState } from "react";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Button,
  Card,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { CoverageReport } from "../../core/domain/DocumentSnapshot";
import { Breadcrumb } from "../shell";
import { parentRoute } from "../routes";
import { isTrackedEditingEnabled, prepareReformatHost } from "../../reformat";
import { formatDiagnostics, probeOfficeRuntime } from "../../shared/office/diagnostics";
import { loadState } from "../../core/state/persistence";
import { isDecisionRoleConfigured, isGeneralRoleConfigured } from "../settings/providerComposition";
import { diagnoseSituation, type TroubleshootingInput } from "../troubleshooting/checks";

/**
 * Re-exported for the surface that renders these, so a caller does not have to
 * know that the registry moved out of this component.
 */
export type { TroubleshootingNote } from "../troubleshooting/checks";

const useStyles = makeStyles({
  /*
   * The raw diagnostic output. `Card` supplies the Fluent surface (border,
   * radius, background); this only makes the block scrollable and monospaced,
   * so a long capability dump cannot stretch the pane.
   */
  output: {
    display: "block",
    overflow: "auto",
    maxHeight: "18rem",
    margin: 0,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "0.5rem",
  },
  noteList: {
    display: "grid",
    gap: "12px",
    margin: 0,
    padding: 0,
    listStyleType: "none",
  },
  note: {
    padding: "10px 12px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderLeft: `3px solid ${tokens.colorStatusWarningBorder1}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  noteTarget: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
});

interface DebuggingPanelProps {
  onBack: () => void;
  coverage?: CoverageReport | null;
  /** Pending and reviewed counts, so the Apply blocker can be reported here too. */
  plannedCount?: number;
  reviewedCount?: number;
  /**
   * How much of the document the last Consistency Review actually compared.
   *
   * Passed in rather than derived here because the report belongs to the
   * Dashboard and is shared with the Deterministic Review findings list. Reading
   * it a second time in this panel would produce a second copy of a report the
   * user can already see on the other tab, and could disagree with it.
   */
  consistency?: {
    usedModel: boolean;
    complete: boolean;
    limitations: readonly string[];
    unresolved: number;
    decisionParseFailed: boolean;
  } | null;
  /**
   * Whether Semantic Review is holding a selection, `null` if it has not been
   * opened. Held by the Dashboard for the same reason.
   */
  semanticSelectionCaptured?: boolean | null;
  /**
   * Characters in the captured selection, `null` when none is held.
   *
   * The cap is a size, so the panel can only explain the refusal with the size.
   * See `TroubleshootingInput.semanticSelectionChars`.
   */
  semanticSelectionChars?: number | null;
  /**
   * Whether the last revision on screen was refused by the local preservation
   * check, so a greyed-out Apply can be explained after the user has navigated
   * away from the page that said why.
   */
  semanticPreservationRefused?: boolean;
}

/**
 * Read the current state once, in the shape the registry takes.
 *
 * Collected here rather than in the registry so `checks.ts` stays pure and can
 * be called from a surface that already holds this state — Apply and the
 * semantic rewrite both know their own blockers, and neither should have to
 * re-derive them to explain themselves.
 */
function currentInput(input: {
  trackedEditing: boolean;
  coverage: CoverageReport | null;
  plannedCount: number;
  reviewedCount: number;
  consistency: {
    usedModel: boolean;
    complete: boolean;
    limitations: readonly string[];
    unresolved: number;
    decisionParseFailed: boolean;
  } | null;
  semanticSelectionCaptured: boolean | null;
  semanticSelectionChars: number | null;
  semanticPreservationRefused: boolean;
  contextMenuApi: boolean | null;
  rangedReplacementSupported: boolean | null;
}): TroubleshootingInput {
  const state = loadState();
  return {
    autoScan: state.settings.autoScan,
    trackedEditing: input.trackedEditing,
    coverage: input.coverage,
    semanticProfileActive: state.activeSemanticProfileId !== null,
    providerConfigured: isGeneralRoleConfigured(state),
    rawTextConsent: state.settings.semanticOptIn,
    plannedCount: input.plannedCount,
    reviewedCount: input.reviewedCount,
    consistency: input.consistency,
    decisionRoleConfigured: isDecisionRoleConfigured(state),
    decisionFallbackPolicy: state.settings.decisionFallbackPolicy,
    semanticSelectionCaptured: input.semanticSelectionCaptured,
    semanticSelectionChars: input.semanticSelectionChars,
    semanticPreservationRefused: input.semanticPreservationRefused,
    contextMenuApi: input.contextMenuApi,
    rangedReplacementSupported: input.rangedReplacementSupported,
  };
}

/**
 * Technical troubleshooting surface, intentionally separate from the normal workflow.
 *
 * This panel inspects; it does not configure. The tracked-editing control used to
 * live here, which put an ordinary user decision behind a diagnostics page and —
 * because its enable path never persisted the flag before probing — made the
 * toggle impossible to arm. It is now a Settings section; this panel reports the
 * current armed state so the two surfaces cannot disagree.
 *
 * The engineering detail is grouped into one Fluent `Accordion` (spec §7.10,
 * §32) so the page opens short and a reader expands only the section they came
 * for. Every section is open by default: this is a diagnostics page, and a
 * collapsed panel that hides the answer the user navigated here for is worse
 * than a long page.
 */
export default function DebuggingPanel({
  onBack,
  coverage = null,
  plannedCount = 0,
  reviewedCount = 0,
  consistency = null,
  semanticSelectionCaptured = null,
  semanticSelectionChars = null,
  semanticPreservationRefused = false,
}: DebuggingPanelProps): React.ReactNode {
  const styles = useStyles();
  const [capabilities, setCapabilities] = useState<Awaited<
    ReturnType<typeof prepareReformatHost>
  > | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [trackedEditing, setTrackedEditing] = useState(isTrackedEditingEnabled);
  const [busy, setBusy] = useState(false);
  /*
   * Which diagnostic the user ran last, not which outputs happen to be on
   * screen. Both outputs persist side by side, so deciding the announcement
   * from "is there a probe result" named the wrong result the moment a second
   * action ran — running the runtime diagnosis after the probe announced the
   * probe, which is the opposite of what happened.
   *
   * `probeFailed` is separate from both completed actions: a probe that threw
   * produced no capability result, and announcing it as a finished diagnosis
   * reported a runtime diagnosis the user never ran. `copied`/`copyFailed` are
   * the clipboard outcome, announced through the same single region.
   */
  const [lastAction, setLastAction] = useState<
    "probe" | "diagnose" | "probeFailed" | "copied" | "copyFailed" | null
  >(null);

  async function probeCapabilities(): Promise<void> {
    setBusy(true);
    setDiagnostics(null);
    try {
      setCapabilities(await prepareReformatHost());
      setLastAction("probe");
    } catch {
      setCapabilities(null);
      setLastAction("probeFailed");
      setDiagnostics(
        "Capability probe did not complete. Confirm the add-in is running inside a supported Word host.",
      );
    } finally {
      // Re-read rather than assuming: the flag may have changed on the Settings
      // page, and a diagnostics panel that reports a stale value is worse than
      // one that reports none.
      setTrackedEditing(isTrackedEditingEnabled());
      setBusy(false);
    }
  }

  /*
   * Copy whatever the panel is currently showing, so a user can paste it into a
   * support request. The confirmation reuses the panel's single live region
   * (ADR-0062) rather than a toaster: the Fluent Toaster renders its own
   * `aria-live` region, and a second one on this page is exactly the defect the
   * one-region test guards against.
   */
  async function copyDiagnostics(): Promise<void> {
    const text = [capabilities ? JSON.stringify(capabilities, null, 2) : null, diagnostics]
      .filter((part): part is string => part !== null)
      .join("\n\n");
    if (text.length === 0) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setLastAction("copied");
    } catch {
      // Do not clobber the output the user is trying to copy: announce the
      // refusal and leave the text on screen to be selected by hand.
      setLastAction("copyFailed");
    }
  }

  // From this panel's own probe rather than passed in: the probe has not run at
  // this point in most sessions, and `null` is the honest answer — "not yet
  // established" rather than "the host does not have it".
  const contextMenuApi = capabilities === null ? null : capabilities.supportsContextMenuApi;
  // `null` until the probe has run, for the same reason as the context menu: a
  // panel that has not looked cannot say the host lacks something.
  const rangedReplacementSupported =
    capabilities === null ? null : capabilities.supportsRangedReplacement;

  const notes = diagnoseSituation(
    currentInput({
      trackedEditing,
      coverage,
      plannedCount,
      reviewedCount,
      consistency,
      semanticSelectionCaptured,
      semanticSelectionChars,
      semanticPreservationRefused,
      contextMenuApi,
      rangedReplacementSupported,
    }),
  );

  const hasOutput = capabilities !== null || diagnostics !== null;

  return (
    <div data-page="debugging">
      <Breadcrumb parent={parentRoute("troubleshooting")} onBack={onBack} />
      <Accordion multiple defaultOpenItems={["host", "why", "coverage", "mutation"]}>
        <AccordionItem value="host">
          <AccordionHeader>Host inspection</AccordionHeader>
          <AccordionPanel>
            <div className={styles.actions}>
              <Button onClick={() => void probeCapabilities()} disabled={busy}>
                {busy ? "Probing capabilities…" : "Probe Word capabilities"}
              </Button>
              <Button
                onClick={() => {
                  setDiagnostics(formatDiagnostics(probeOfficeRuntime()));
                  setLastAction("diagnose");
                }}
              >
                Diagnose Office runtime
              </Button>
              <Button onClick={() => void copyDiagnostics()} disabled={!hasOutput}>
                Copy diagnostics
              </Button>
            </div>
            {/*
              One live region, not one per output. Probing and then diagnosing
              leaves both blocks on screen, and two polite regions updating in one
              session read in DOM order rather than in the order they were run —
              the same defect ADR-0062 fixed on the Dashboard. The text therefore
              follows `lastAction`, so the announcement names the run that
              actually happened last.
            */}
            <p className="sr-only" role="status" aria-live="polite">
              {lastAction === "probe"
                ? "Capability probe finished. The result is below."
                : lastAction === "diagnose"
                  ? "Office runtime diagnosis finished. The result is below."
                  : lastAction === "probeFailed"
                    ? "Capability probe did not complete. The reason is below."
                    : lastAction === "copied"
                      ? "Diagnostics copied to the clipboard."
                      : lastAction === "copyFailed"
                        ? "Copying to the clipboard was refused by the host. Select the text and copy it manually."
                        : ""}
            </p>
            {capabilities && (
              <Card>
                <Text as="pre" className={styles.output}>
                  {JSON.stringify(capabilities, null, 2)}
                </Text>
              </Card>
            )}
            {diagnostics && (
              <Card>
                <Text as="pre" className={styles.output}>
                  {diagnostics}
                </Text>
              </Card>
            )}
          </AccordionPanel>
        </AccordionItem>

        {/*
          What is actually wrong right now. Above this point the panel answers
          "what does this host support"; this answers "why is the pane not doing
          what I expect", which is the question a person arrives here with.

          The section is titled for the question, not for a control: this is the one
          place every surface's blockers are collected, so the user has somewhere
          to look that is not the surface refusing them. The title was "What to
          check", which named an action rather than the answer to the question.
        */}
        <AccordionItem value="why">
          <AccordionHeader>Why something may not be working</AccordionHeader>
          <AccordionPanel>
            <p className="tf-sub">
              Everything the other pages would refuse to do, and the setting behind each one. Only
              situations that are true right now are listed.
            </p>
            {notes.length === 0 ? (
              /*
               * Enumerated rather than "nothing is wrong", because this registry
               * only sees what it is given and a run of unchecked situations reads
               * as a clean bill of health. Every situation below has a check above;
               * adding one here is the cost of a new input field.
               */
              <p className="tf-sub">
                Nothing is currently standing in the way: automatic scanning is on, tracked editing
                is enabled, a semantic profile is active, a provider is configured, sending your
                text to that provider is allowed, every finding waiting to be applied has been
                reviewed, the Semantic tab is holding a paragraph if one was wanted, and any
                analysis that has run covered the whole document.
                {/*
                  Only the checks that have actually run. This sentence is a claim
                  about the host and about past runs, and "no review has been run"
                  is not the same as "every review that ran was complete" — a
                  registry that only sees what it is handed cannot tell the user the
                  second thing from the first.
                */}
                {consistency === null
                  ? " No consistency review has been run in this session, so this panel cannot say whether one would be complete."
                  : " Any consistency review that has run compared everything it set out to compare."}
                {contextMenuApi === null
                  ? " The context-menu capability has not been probed on this host yet, so this panel cannot say whether the host supports it."
                  : " The host exposes the context-menu API."}
              </p>
            ) : (
              <ul className={styles.noteList}>
                {notes.map((note) => (
                  <li key={note.id} className={styles.note}>
                    <p>
                      <strong>{note.situation}</strong>
                    </p>
                    <p>{note.cause}</p>
                    <p>{note.remedy}</p>
                    {/*
                      The target, on its own labelled line. Folding it into the
                      remedy prose meant the one actionable part was indistinguishable
                      from the explanation around it.
                    */}
                    <p className={styles.noteTarget}>
                      <span>Change this: </span>
                      {note.remedyTarget.label}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem value="coverage">
          <AccordionHeader>Analysis coverage diagnostics</AccordionHeader>
          <AccordionPanel>
            {coverage ? (
              <Card>
                <Text as="pre" className={styles.output}>
                  {JSON.stringify(
                    {
                      complete: coverage.complete,
                      processedCharacterCount: coverage.processedCharacterCount,
                      examinedNodeCount: coverage.examinedNodeIds.length,
                      unsupported: coverage.unsupported,
                      unprocessed: coverage.unprocessed,
                      excluded: coverage.excluded,
                      acquisition: coverage.acquisition ?? null,
                    },
                    null,
                    2,
                  )}
                </Text>
              </Card>
            ) : (
              <p className="tf-sub">No analysis coverage has been recorded in this session.</p>
            )}
          </AccordionPanel>
        </AccordionItem>

        <AccordionItem value="mutation">
          <AccordionHeader>Mutation readiness</AccordionHeader>
          <AccordionPanel>
            <p>
              Tracked editing is currently{" "}
              <strong>{trackedEditing ? "enabled" : "disabled"}</strong>. Change it in Settings,
              where the host probe runs as part of the change.
            </p>
            <p>
              Apply performs a fresh host probe and checks every operation in the plan. Track
              Changes can never be bypassed.
            </p>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
