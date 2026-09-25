/**
 * Stage 22 — Safe reformat preview panel.
 *
 * This component creates the exact reviewed plan and hands it to the dashboard.
 * The single Apply action lives in Pending Changes and is the only production
 * route into the safe apply orchestration.
 *
 * Boundary: this component may import `reformat/`, `core/*`, `shared/*`,
 * and `ai/providers` types. It must never import `word/revisionAdapter`.
 */

import React from "react";
import { reformatDocument, type ReformatResult } from "../../reformat";
import { loadState } from "../../core/state/persistence";
import { createGovernanceProfile } from "../../core/domain/GovernanceProfile";
import type { StyleProfile } from "../../core/domain/StyleProfile";
import type { LlmSemanticProvider } from "../../ai/providers/LlmProvider";

export interface ReformatPanelProps {
  /** Active style profile driving analysis and planning. */
  profile: StyleProfile;
  /** Called when a preview is ready so the main page can show the exact plan. */
  onPreview?: (result: ReformatResult) => void;
  /** Optional max chars for document reads. */
  maxChars?: number;
  /** Optional semantic provider; tests inject a MockAdapter-backed registry. */
  registry?: LlmSemanticProvider;
}

type PanelPhase = "idle" | "previewing" | "ready";

interface PanelMessage {
  kind: "info" | "success" | "error";
  text: string;
}

function messageStyle(kind: PanelMessage["kind"]): React.CSSProperties {
  return {
    color: kind === "error" ? "#a4262c" : kind === "success" ? "#0b6a0b" : "inherit",
  };
}

export default function ReformatPanel({
  profile,
  maxChars,
  registry,
  onPreview,
}: ReformatPanelProps): React.ReactNode {
  const [phase, setPhase] = React.useState<PanelPhase>("idle");
  const [result, setResult] = React.useState<ReformatResult | null>(null);
  const [messages, setMessages] = React.useState<PanelMessage[]>([]);
  const state = loadState();
  const includeRawText = state.settings.semanticOptIn;
  const governanceId = state.activeGovernanceProfileId ?? state.activeProfileId;
  const governance =
    (governanceId === null ? undefined : state.governanceProfiles[governanceId]) ??
    createGovernanceProfile(profile);

  function pushMessages(next: PanelMessage[]): void {
    setMessages((previous) => [...previous, ...next]);
  }

  async function runPreview(): Promise<void> {
    setPhase("previewing");
    setMessages([]);
    setResult(null);
    try {
      const preview = await reformatDocument({
        profile,
        preview: true,
        includeRawText,
        policy: governance,
        ...(maxChars !== undefined ? { maxChars } : {}),
        ...(registry ? { registry } : {}),
      });
      setResult(preview);
      onPreview?.(preview);
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
            text: `Preview ready: ${preview.plan.changes.length} change(s), ${(preview.plan.conflicts ?? []).length} conflict(s). Review the proposed changes in Pending Changes.`,
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

  const busy = phase === "previewing";
  const planCoverage = result?.report.coverage ?? null;
  const coverageIncomplete = planCoverage?.complete === false;

  return (
    <section aria-label="Safe reformat" style={{ marginTop: "1.5rem" }}>
      <h2>Safe reformat</h2>
      <p>
        Preview the planned changes for profile “{profile.name}”. Review the exact plan in Pending
        Changes before using the single Apply action with revision tracking.
      </p>

      <p className="tf-sub">
        Semantic reformat follows the scope-specific consent saved in Settings. Deterministic
        reformat remains available when semantic analysis is disabled.
      </p>

      <div style={{ marginTop: "0.75rem" }}>
        <button type="button" onClick={runPreview} disabled={busy}>
          {phase === "previewing" ? "Previewing…" : "Preview changes"}
        </button>
      </div>

      {result && (result.plan.conflicts ?? []).length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ color: "#a4262c" }}>
            {(result.plan.conflicts ?? []).length} conflict(s) block application. Regenerate the
            preview after reviewing the conflict list.
          </p>
          <ul aria-live="polite">
            {(result.plan.conflicts ?? []).map((conflict, index) => {
              const message = typeof conflict === "string" ? conflict : conflict.message;
              return <li key={index}>{message}</li>;
            })}
          </ul>
        </div>
      )}

      {result && result.plan.changes.length > 0 && (
        <section aria-label="Change previews" style={{ marginTop: "0.75rem" }}>
          <h3>Change previews</h3>
          <p className="tf-sub" role="status">
            Coverage: {coverageIncomplete ? "incomplete" : "complete"}; plan changes:{" "}
            {result.plan.changes.length}; governance policy revision:{" "}
            {result.plan.governancePolicyRevision ?? "unavailable"}.
          </p>
          <ul aria-live="polite">
            {result.plan.changes.map((change) => {
              const finding = result.report.findings.find((item) => item.id === change.findingId);
              return (
                <li key={change.id}>
                  <div>
                    {change.type} — source: {change.source ?? "unavailable"}; approval:{" "}
                    {change.approvalState ?? "unavailable"}; precondition:{" "}
                    {change.precondition?.kind ?? "unavailable"}.
                  </div>
                  <div>Before: {finding?.actual ?? "Unavailable (not supplied by this plan)"}</div>
                  <div>After: {finding?.expected ?? "Unavailable (not supplied by this plan)"}</div>
                </li>
              );
            })}
          </ul>
        </section>
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
