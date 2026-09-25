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
import { applyReviewedPlan, reformatDocument, type ReformatResult } from "../../reformat";
import { loadState } from "../../core/state/persistence";
import { createGovernanceProfile } from "../../core/domain/GovernanceProfile";
import type { StyleProfile } from "../../core/domain/StyleProfile";
import type { LlmSemanticProvider } from "../../ai/providers/LlmProvider";
import type { WordCapabilities } from "../../word/capabilityProbe";

export interface ReformatPanelProps {
  /** Active style profile driving analysis and planning. */
  profile: StyleProfile;
  /** Called when a preview is ready so the main page can show the exact plan. */
  onPreview?: (result: ReformatResult) => void;
  /** Optional max chars for document reads. */
  maxChars?: number;
  /** Optional semantic provider; tests inject a MockAdapter-backed registry. */
  registry?: LlmSemanticProvider;
  /** Read-only host capability snapshot; absence blocks actionable Apply. */
  capabilities?: WordCapabilities | null;
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

export default function ReformatPanel({
  profile,
  maxChars,
  registry,
  capabilities,
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
            text: `Preview ready: ${preview.plan.changes.length} change(s), ${(preview.plan.conflicts ?? []).length} conflict(s). Review below, then Apply.`,
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
    if (!result || !canApply) return;
    setPhase("applying");
    setMessages([]);
    try {
      const applied = await applyReviewedPlan({
        plan: result.plan,
        currentGovernancePolicyRevision: governance.version,
        ...(result.report.coverage ? { coverage: result.report.coverage } : {}),
        allowConflictingApply: false,
        ...(maxChars !== undefined ? { maxChars } : {}),
      });
      if (applied.applied && applied.verified) {
        setPhase("applied");
        pushMessages([
          { kind: "success", text: "All reviewed changes were applied and verified." },
        ]);
      } else if (applied.stale) {
        setPhase("refused");
        pushMessages([
          { kind: "error", text: "The document changed since preview. Preview again." },
        ]);
      } else {
        setPhase("refused");
        const failed = applied.results.find((item) => !item.applied);
        pushMessages([
          {
            kind: "error",
            text: applied.verificationError ?? failed?.error ?? "Apply was not completed.",
          },
        ]);
      }
    } catch (err) {
      setPhase("ready");
      pushMessages([
        {
          kind: "error",
          text: `Apply failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    }
  }

  const busy = phase === "previewing" || phase === "applying";
  const capabilitiesVerified = capabilities !== null && capabilities !== undefined;
  const requiredCapabilities = result
    ? [
        ...new Set(
          result.plan.changes.map((change) => {
            switch (change.type) {
              case "insertText":
                return "supportsInsertText" as const;
              case "replaceText":
              case "deleteRange":
                return "supportsReplaceText" as const;
              case "insertBreak":
                return "supportsInsertBreak" as const;
              case "applyStyle":
                return "supportsStyles" as const;
              case "setParagraphFormat":
                return "supportsParagraphFormat" as const;
              case "setCharacterFormat":
                return "supportsCharacterFormat" as const;
              case "resetCharacterFormatting":
                return "supportsResetCharacterFormatting" as const;
              case "setListLevel":
                return "supportsListLevel" as const;
            }
          }),
        ),
      ]
    : [];
  const unsupportedCapabilities = capabilitiesVerified
    ? requiredCapabilities.filter((capability) => capabilities[capability] === false)
    : [];
  const hostSupportsPlan =
    capabilitiesVerified && capabilities.supportsRevisions && unsupportedCapabilities.length === 0;
  const unapprovedChanges =
    result?.plan.changes.filter(
      (change) => change.approvalRequired && change.approvalState !== "approved",
    ) ?? [];
  const preconditionFailures =
    result?.plan.changes.filter((change) => change.precondition === undefined) ?? [];
  const canApply =
    result !== null &&
    result.plan.schemaVersion === 2 &&
    result.plan.changes.length > 0 &&
    !result.plan.stale &&
    (result.plan.conflicts ?? []).length === 0 &&
    hostSupportsPlan &&
    unapprovedChanges.length === 0 &&
    preconditionFailures.length === 0;
  const readinessReasons = result
    ? [
        ...(result.plan.schemaVersion !== 2
          ? ["Preview again to create a schema version 2 plan."]
          : []),
        ...(result.report.coverage?.complete === false
          ? [
              "Analysis coverage is incomplete; apply is advisory and may be refused by reviewed apply.",
            ]
          : []),
        ...(result.plan.stale ? ["Preview again because the document changed."] : []),
        ...((result.plan.conflicts ?? []).length > 0
          ? ["Resolve plan conflicts before applying."]
          : []),
        ...unsupportedCapabilities.map(
          (capability) => `This host cannot perform ${capability.replace("supports", "")}.`,
        ),
        ...(!result.tracking.managed ? ["Managed Track Changes is unavailable."] : []),
        ...(unapprovedChanges.length > 0
          ? [`${unapprovedChanges.length} change(s) require approval before applying.`]
          : []),
        ...(preconditionFailures.length > 0
          ? [`${preconditionFailures.length} change(s) have no verifiable target precondition.`]
          : []),
        ...(!hostSupportsPlan && result.plan.changes.length > 0
          ? ["The current host capability check does not support this plan."]
          : []),
      ]
    : [];
  const planCoverage = result?.report.coverage ?? null;
  const coverageIncomplete = planCoverage?.complete === false;

  return (
    <section aria-label="Safe reformat" style={{ marginTop: "1.5rem" }}>
      <h2>Safe reformat</h2>
      <p>
        Preview the planned changes for profile “{profile.name}”, then confirm to apply them with
        revision tracking. The orchestrator re-hashes the document immediately before applying and
        refuses stale or conflicting plans.
      </p>

      <p className="tf-sub">
        Semantic reformat follows the scope-specific consent saved in Settings. Deterministic
        reformat remains available when semantic analysis is disabled.
      </p>

      {!capabilitiesVerified && (
        <p role="status" className="tf-sub">
          Word is checking mutation readiness. Preview is available while the host is inspected.
        </p>
      )}
      {capabilitiesVerified && !hostSupportsPlan && (
        <p role="status" className="tf-sub">
          This Word host does not support every operation in the reviewed plan. Preview remains
          available; unsupported operations must be fixed in the plan before apply.
        </p>
      )}

      <div style={{ marginTop: "0.75rem" }}>
        <button type="button" onClick={runPreview} disabled={busy}>
          {phase === "previewing" ? "Previewing…" : "Preview changes"}
        </button>
        <button
          type="button"
          onClick={runApply}
          disabled={busy || !canApply}
          aria-describedby={!canApply ? "apply-readiness" : undefined}
          style={{ marginLeft: "0.5rem" }}
        >
          {phase === "applying" ? "Applying…" : "Apply changes"}
        </button>
      </div>
      {(!capabilitiesVerified || !canApply) && (
        <ul id="apply-readiness" className="tf-sub" aria-live="polite">
          {!capabilitiesVerified && (
            <li>
              Apply performs a fresh host capability check immediately before any tracked edit.
            </li>
          )}
          {readinessReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

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
