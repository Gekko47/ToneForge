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
  const includeRawText = loadState().settings.semanticOptIn;

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
    if (!result || !canApply) return;
    setPhase("applying");
    setMessages([]);
    try {
      const applied = await applyReviewedPlan({
        plan: result.plan,
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
  const canApply =
    result !== null &&
    result.plan.changes.length > 0 &&
    !result.plan.stale &&
    result.plan.conflicts.length === 0;

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
      {!capabilitiesVerified && (
        <p id="apply-readiness" className="tf-sub">
          Apply performs a fresh host capability check immediately before any tracked edit.
        </p>
      )}
      {capabilitiesVerified && !canApply && result !== null && (
        <ul id="apply-readiness" className="tf-sub">
          {result.plan.stale && <li>Preview again because the document changed.</li>}
          {result.plan.conflicts.length > 0 && <li>Resolve plan conflicts before applying.</li>}
          {unsupportedCapabilities.map((capability) => (
            <li key={capability}>This host cannot perform {capability.replace("supports", "")}.</li>
          ))}
          {!result.tracking.managed && <li>Managed Track Changes is unavailable.</li>}
        </ul>
      )}

      {result && result.plan.conflicts.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ color: "#a4262c" }}>
            {result.plan.conflicts.length} conflict(s) block application. Regenerate the preview
            after reviewing the conflict list.
          </p>
          <ul aria-live="polite">
            {result.plan.conflicts.map((conflict, index) => {
              const message = typeof conflict === "string" ? conflict : conflict.message;
              return <li key={index}>{message}</li>;
            })}
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
