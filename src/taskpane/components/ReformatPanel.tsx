/**
 * Stage 22 — Safe reformat panel.
 *
 * Preview → confirm → apply workflow built on the Stage 21 orchestrator.
 * The panel never imports `word/revisionAdapter` directly (ESLint forbids
 * it); all mutations flow through `reformatDocument()`, which owns the
 * live re-hash, conflict refusal, and Stage 01 gate checks.
 *
 * Boundary: this component may import `reformat/`, `core/*`, `shared/*`,
 * and `ai/providers` types. It must never import `word/revisionAdapter`.
 */

import React from "react";
import { reformatDocument, type ReformatResult } from "../../reformat";
import type { StyleProfile } from "../../core/domain/StyleProfile";
import type { LlmSemanticProvider } from "../../ai/providers/LlmProvider";

export interface ReformatPanelProps {
  /** Active style profile driving analysis and planning. */
  profile: StyleProfile;
  /** Optional max chars for document reads. */
  maxChars?: number;
  /** Optional semantic provider; tests inject a MockAdapter-backed registry. */
  registry?: LlmSemanticProvider;
}

type PanelPhase = "idle" | "previewing" | "ready" | "applying" | "applied" | "refused";

interface PanelMessage {
  kind: "info" | "success" | "error";
  text: string;
}

function messageStyle(kind: PanelMessage["kind"]): React.CSSProperties {
  return {
    color: kind === "error" ? "#a4262c" : kind === "success" ? "#0b6a0b" : "inherit",
  };
}

function formatTracking(result: ReformatResult): string {
  const tracking = result.tracking;
  const parts = [`managed: ${tracking.managed ? "yes" : "no"}`];
  if (tracking.modeBefore !== undefined) parts.push(`before: ${tracking.modeBefore}`);
  if (tracking.modeAfter !== undefined) parts.push(`after: ${tracking.modeAfter}`);
  if (tracking.recordedCount !== undefined) parts.push(`recorded: ${tracking.recordedCount}`);
  return parts.join(", ");
}

export default function ReformatPanel({
  profile,
  maxChars,
  registry,
}: ReformatPanelProps): React.ReactNode {
  const [phase, setPhase] = React.useState<PanelPhase>("idle");
  const [result, setResult] = React.useState<ReformatResult | null>(null);
  const [messages, setMessages] = React.useState<PanelMessage[]>([]);
  const [includeRawText, setIncludeRawText] = React.useState(false);
  const [acknowledgeConflicts, setAcknowledgeConflicts] = React.useState(false);

  function pushMessages(next: PanelMessage[]): void {
    setMessages((previous) => [...previous, ...next]);
  }

  async function runPreview(): Promise<void> {
    setPhase("previewing");
    setResult(null);
    setAcknowledgeConflicts(false);
    try {
      const preview = await reformatDocument({
        profile,
        preview: true,
        includeRawText,
        ...(maxChars !== undefined ? { maxChars } : {}),
        ...(registry ? { registry } : {}),
      });
      setResult(preview);
      setPhase("ready");
      if (preview.plan.changes.length === 0) {
        pushMessages([
          {
            kind: "success",
            text: "No deviations found — the document already matches this profile.",
          },
        ]);
      } else {
        pushMessages([
          {
            kind: "info",
            text: `Preview ready: ${preview.plan.changes.length} change(s), ${preview.plan.conflicts.length} conflict(s). Review below, then Apply.`,
          },
        ]);
      }
      if (preview.plan.stale) {
        pushMessages([
          { kind: "error", text: "Preview plan is stale; re-run preview before applying." },
        ]);
      }
    } catch (err) {
      pushMessages([
        {
          kind: "error",
          text: `Preview failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
      setPhase("idle");
    }
  }

  async function runApply(): Promise<void> {
    if (!result) return;
    setPhase("applying");
    try {
      const applied = await reformatDocument({
        profile,
        includeRawText,
        allowConflictingApply: acknowledgeConflicts,
        ...(maxChars !== undefined ? { maxChars } : {}),
        ...(registry ? { registry } : {}),
      });
      setResult(applied);
      if (applied.applied) {
        setPhase("applied");
        pushMessages([
          {
            kind: "success",
            text: `Applied ${applied.results.filter((item) => item.applied).length} of ${applied.results.length} change(s). Tracking [${formatTracking(applied)}].`,
          },
        ]);
      } else {
        setPhase("refused");
        const failed = applied.results.filter((item) => !item.applied);
        if (applied.stale) {
          pushMessages([
            {
              kind: "error",
              text: "Apply refused: the document changed since the preview. Re-run preview.",
            },
          ]);
        } else if (applied.plan.conflicts.length > 0) {
          pushMessages([
            {
              kind: "error",
              text: `Apply refused: ${applied.plan.conflicts.length} unresolved conflict(s). Acknowledge the conflicts to proceed.`,
            },
          ]);
        } else if (failed.length > 0) {
          pushMessages([
            {
              kind: "error",
              text: `Apply blocked: ${failed[0]?.error ?? "mutation gate refused the plan"}.`,
            },
          ]);
        } else {
          pushMessages([{ kind: "info", text: "Apply completed with no changes applied." }]);
        }
      }
    } catch (err) {
      pushMessages([
        {
          kind: "error",
          text: `Apply failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
      setPhase("ready");
    }
  }

  const busy = phase === "previewing" || phase === "applying";
  const canApply =
    result !== null &&
    result.plan.changes.length > 0 &&
    !result.plan.stale &&
    (result.plan.conflicts.length === 0 || acknowledgeConflicts);

  return (
    <section aria-label="Safe reformat" style={{ marginTop: "1.5rem" }}>
      <h2>Safe reformat</h2>
      <p>
        Preview the planned changes for profile “{profile.name}”, then confirm to apply them with
        revision tracking. The orchestrator re-hashes the document immediately before applying and
        refuses stale or conflicting plans.
      </p>

      <label style={{ display: "block", marginTop: "0.5rem" }}>
        <input
          type="checkbox"
          checked={includeRawText}
          onChange={(event) => setIncludeRawText(event.target.checked)}
          disabled={busy}
        />{" "}
        Allow semantic analysis on document text (explicit opt-in)
      </label>

      <div style={{ marginTop: "0.75rem" }}>
        <button type="button" onClick={runPreview} disabled={busy}>
          {phase === "previewing" ? "Previewing…" : "Preview changes"}
        </button>
        <button
          type="button"
          onClick={runApply}
          disabled={busy || !canApply}
          style={{ marginLeft: "0.5rem" }}
        >
          {phase === "applying" ? "Applying…" : "Apply changes"}
        </button>
      </div>

      {result && result.plan.conflicts.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ color: "#a4262c" }}>
            {result.plan.conflicts.length} conflict(s) require review before applying.
          </p>
          <label>
            <input
              type="checkbox"
              checked={acknowledgeConflicts}
              onChange={(event) => setAcknowledgeConflicts(event.target.checked)}
              disabled={busy}
            />{" "}
            I have reviewed the conflicts and accept the risk of contradictory edits.
          </label>
          <ul aria-live="polite">
            {result.plan.conflicts.map((conflict) => (
              <li key={conflict}>{conflict}</li>
            ))}
          </ul>
        </div>
      )}

      {result && result.plan.changes.length > 0 && (
        <ul aria-live="polite" style={{ marginTop: "0.75rem" }}>
          {result.report.findings.slice(0, 20).map((finding) => (
            <li key={finding.id}>
              {finding.message} [{finding.range.start}, {finding.range.end}]
            </li>
          ))}
          {result.report.findings.length > 20 && (
            <li>…and {result.report.findings.length - 20} more finding(s).</li>
          )}
        </ul>
      )}

      {messages.length > 0 && (
        <ul aria-live="polite" style={{ marginTop: "0.75rem" }}>
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
