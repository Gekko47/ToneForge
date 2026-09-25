/**
 * Stage 18 smoke-test panel (debug scaffolding, not the Stage 21
 * orchestrator).
 *
 * Two minimal workflows that close the live-verification gap:
 *
 * A. Apply the active style profile to the current selection — runs the
 *    deterministic typography + house-style rules over the selected text,
 *    previews findings, plans them, and applies the plan with revision
 *    tracking managed around the mutations.
 * B. ChangePlan smoke test — enables the Stage 01 gate explicitly, builds a
 *    small demo plan against the live document, previews it, and applies it
 *    with revision tracking managed around the mutations.
 *
 * Boundary: this component never imports `word/revisionAdapter` directly
 * (ESLint forbids it). All mutations flow through `word/smokeApply`, which
 * will be superseded by the Stage 21 orchestrator.
 */

import React from "react";
import { loadState } from "../../core/state/persistence";
import { selectActiveProfile } from "../../core/state/profileSelectors";
import type { StyleProfile } from "../../core/domain/StyleProfile";
import type { ChangePlan } from "../../core/domain/ChangePlan";
import type { Finding } from "../../core/domain/Finding";
import { getDocumentSnapshot, getSelectionText } from "../../word/documentReader";
import { probeWordCapabilities } from "../../word/capabilityProbe";
import {
  applySmokePlan,
  buildDemoChangePlan,
  enableSmokeMutations,
  type DemoPlan,
} from "../../word/smokeApply";
import { buildSelectionChangePlan, snapshotHashOrCompute } from "./smokePlan";

type ApplyOutcome = Awaited<ReturnType<typeof applySmokePlan>>;

interface PanelMessage {
  kind: "info" | "success" | "error";
  text: string;
}

interface SelectionPreview {
  plan: ChangePlan;
  findings: Finding[];
  profileName: string;
  selectionStart: number;
}

function messageStyle(kind: PanelMessage["kind"]): React.CSSProperties {
  return {
    color: kind === "error" ? "#a4262c" : kind === "success" ? "#0b6a0b" : "inherit",
  };
}

function formatTracking(outcome: ApplyOutcome): string {
  const tracking = outcome.tracking;
  const parts = [`managed: ${tracking.managed ? "yes" : "no"}`];
  if (tracking.modeBefore !== undefined) parts.push(`before: ${tracking.modeBefore}`);
  if (tracking.modeAfter !== undefined) parts.push(`after: ${tracking.modeAfter}`);
  if (tracking.recordedCount !== undefined) parts.push(`recorded: ${tracking.recordedCount}`);
  return parts.join(", ");
}

function formatOutcome(outcome: ApplyOutcome): PanelMessage[] {
  const applied = outcome.results.filter((result) => result.applied);
  const failed = outcome.results.filter((result) => !result.applied);
  const messages: PanelMessage[] = [
    {
      kind: failed.length === 0 ? "success" : "error",
      text: `Applied ${applied.length} of ${outcome.results.length} change(s). Tracking [${formatTracking(outcome)}].`,
    },
  ];
  for (const result of failed) {
    messages.push({
      kind: "error",
      text: `Change ${result.changeId} failed: ${result.error ?? "unknown error"}`,
    });
  }
  return messages;
}

function resolveActiveProfile(): { profile: StyleProfile } | { error: string } {
  const profile = selectActiveProfile(loadState());
  if (!profile) {
    return { error: "No style profile found — create one under Style profile first." };
  }
  return { profile };
}

export interface SmokePanelProps {
  /** Historical controls remain disabled until the troubleshooting user confirms mutation risk. */
  confirmed?: boolean;
}

export default function SmokePanel({ confirmed = false }: SmokePanelProps = {}): React.ReactNode {
  const [busy, setBusy] = React.useState(false);
  const [gateEnabled, setGateEnabled] = React.useState(false);
  const [selectionPreview, setSelectionPreview] = React.useState<SelectionPreview | null>(null);
  const [demoPreview, setDemoPreview] = React.useState<DemoPlan | null>(null);
  const [messages, setMessages] = React.useState<PanelMessage[]>([]);

  function pushMessages(next: PanelMessage[]): void {
    setMessages((previous) => [...previous, ...next]);
  }

  async function checkSelection(): Promise<void> {
    setBusy(true);
    setSelectionPreview(null);
    try {
      const resolved = resolveActiveProfile();
      if ("error" in resolved) {
        pushMessages([{ kind: "error", text: resolved.error }]);
        return;
      }
      const selectionText = await getSelectionText();
      if (selectionText.trim().length === 0) {
        pushMessages([{ kind: "error", text: "Select some text in the document first." }]);
        return;
      }
      const snapshot = await getDocumentSnapshot();
      const built = buildSelectionChangePlan({
        bodyText: snapshot.text,
        selectionText,
        profile: resolved.profile,
        docHash: snapshotHashOrCompute(snapshot.text, snapshot.hash),
        baseDocId: snapshot.id,
      });
      if ("error" in built) {
        pushMessages([{ kind: "error", text: built.error }]);
        return;
      }
      setSelectionPreview({
        plan: built.plan.plan,
        findings: built.plan.findings,
        profileName: resolved.profile.name,
        selectionStart: built.plan.selectionStart,
      });
      if (built.plan.findings.length === 0) {
        pushMessages([
          {
            kind: "success",
            text: `No deviations found — selection already matches “${resolved.profile.name}”.`,
          },
        ]);
      } else {
        pushMessages([
          {
            kind: "info",
            text: `Found ${built.plan.findings.length} finding(s) producing ${built.plan.plan.changes.length} change(s). Review below, then Apply.`,
          },
        ]);
      }
    } catch (err) {
      pushMessages([
        {
          kind: "error",
          text: `Selection check failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function applySelectionPlan(): Promise<void> {
    if (!selectionPreview || !confirmed) return;
    setBusy(true);
    try {
      const snapshot = await getDocumentSnapshot();
      const outcome = await applySmokePlan(
        selectionPreview.plan,
        snapshotHashOrCompute(snapshot.text, snapshot.hash),
      );
      pushMessages(formatOutcome(outcome));
      setSelectionPreview(null);
    } catch (err) {
      pushMessages([
        {
          kind: "error",
          text: `Apply failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function enableGate(): Promise<void> {
    if (!confirmed) return;
    setBusy(true);
    try {
      const caps = await probeWordCapabilities();
      if (!caps.supportsInsertText) {
        pushMessages([
          {
            kind: "error",
            text: "Host does not support text insertion — mutations stay disabled.",
          },
        ]);
        return;
      }
      enableSmokeMutations(caps);
      setGateEnabled(true);
      pushMessages([
        { kind: "success", text: "Stage 01 gate enabled for this session. Mutations allowed." },
      ]);
    } catch (err) {
      pushMessages([
        {
          kind: "error",
          text: `Gate enable failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function buildDemo(): Promise<void> {
    setBusy(true);
    setDemoPreview(null);
    try {
      const demo = await buildDemoChangePlan();
      setDemoPreview(demo);
      pushMessages([
        {
          kind: "info",
          text: `Demo plan ready with ${demo.plan.changes.length} change(s). Review below, then Apply.`,
        },
      ]);
    } catch (err) {
      pushMessages([
        {
          kind: "error",
          text: `Demo build failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function applyDemo(): Promise<void> {
    if (!demoPreview || !confirmed) return;
    setBusy(true);
    try {
      const snapshot = await getDocumentSnapshot();
      const outcome = await applySmokePlan(
        demoPreview.plan,
        snapshotHashOrCompute(snapshot.text, snapshot.hash),
      );
      pushMessages(formatOutcome(outcome));
      setDemoPreview(null);
    } catch (err) {
      pushMessages([
        {
          kind: "error",
          text: `Apply failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Stage 18 smoke test" style={{ marginTop: "1.5rem" }}>
      <h2>Stage 18 smoke test (debug)</h2>
      <p>
        Minimal wiring to prove the mutation path live in Word. Superseded by the Stage 21
        orchestrator when it lands.
      </p>

      <h3>1. Apply active profile to selection</h3>
      <button type="button" onClick={checkSelection} disabled={busy}>
        Check selection
      </button>
      <button
        type="button"
        onClick={applySelectionPlan}
        disabled={busy || !confirmed || !selectionPreview || selectionPreview.findings.length === 0}
        style={{ marginLeft: "0.5rem" }}
      >
        Apply plan
      </button>
      {selectionPreview && selectionPreview.findings.length > 0 && (
        <ul aria-live="polite">
          {selectionPreview.findings.map((finding) => (
            <li key={finding.id}>
              {finding.message} [{finding.range.start}, {finding.range.end}]
            </li>
          ))}
        </ul>
      )}

      <h3>2. ChangePlan smoke test</h3>
      <button type="button" onClick={enableGate} disabled={busy || gateEnabled || !confirmed}>
        {gateEnabled ? "Gate enabled" : "Enable mutations (Stage 01 gate)"}
      </button>
      <button type="button" onClick={buildDemo} disabled={busy} style={{ marginLeft: "0.5rem" }}>
        Build demo plan
      </button>
      <button
        type="button"
        onClick={applyDemo}
        disabled={busy || !confirmed || !demoPreview || !gateEnabled}
        style={{ marginLeft: "0.5rem" }}
      >
        Apply demo plan
      </button>
      {demoPreview && (
        <ul aria-live="polite">
          {demoPreview.summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {!confirmed && (
        <p role="status">
          Confirm the mutation warning in Troubleshooting before using these controls.
        </p>
      )}
      {messages.length > 0 && (
        <ul aria-live="polite">
          {messages.map((message, index) => (
            <li key={`${index}-${message.text}`} style={messageStyle(message.kind)}>
              {message.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
