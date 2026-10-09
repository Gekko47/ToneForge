/**
 * AiReviewSection — the single AI Review surface.
 *
 * This page is one review, not several stacked beneath each other. It checks
 * whether different parts of the document disagree with each other, which is
 * cross-report consistency review and nothing else. Two independent things used
 * to be presented here as peers — a spot/full-document style review and the
 * consistency check — and reading the page meant reading two disclosures, two
 * consent stories, and a run of buttons that did not correspond to either. One
 * engine, one consent, one action, one result.
 *
 * What this consolidation does **not** do: it does not merge the consents. The
 * consent that gates this engine is still `consistencyReviewConsent`, still
 * stored separately, and still not implied by any other permission (ADR-0052).
 * Collapsing the surface must not quietly relax what the user agreed to.
 *
 * The prerequisite hint is computed once. Previously each disabled control
 * carried its own copy of the same sentence, so a single missing consent was
 * announced three times on a page with one feature on it.
 */

import React from "react";
import ConsistencyReviewPreflight from "./ConsistencyReviewPreflight";
import ConsistencyReviewProgress from "./ConsistencyReviewProgress";
import ConsistencyReviewResults from "./ConsistencyReviewResults";
import {
  CONSISTENCY_DEFAULT_MAX_PER_SUBJECT,
  type ConsistencyProgress,
  type ConsistencyReport,
} from "../../analysis/consistency";

export type AiReviewStage = "idle" | "preflight" | "running" | "results";

/**
 * What the preflight is opened with, measured by `buildPreflight` on the page.
 *
 * `storageNote` and `allowUnredacted` are carried here rather than recomputed in
 * the component so the disclosure and the run cannot disagree: the page holds
 * the one `allowUnredacted` value it will send, and the preflight renders the
 * redaction list from that same value.
 */
export interface AiReviewPreflight {
  wordCount: number;
  statementCount: number;
  storageNote: string;
  allowUnredacted: boolean;
}

export interface AiReviewSectionProps {
  stage: AiReviewStage;
  providerConfigured: boolean;
  hasConsent: boolean;
  providerName: string;
  preflight: AiReviewPreflight | null;
  progress: ConsistencyProgress | null;
  /** True once the user has cancelled, so a partial run says so. */
  cancelled: boolean;
  result: ConsistencyReport | null;
  message: string | null;
  onOpenSettings: () => void;
  onStart: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onCancelRun: () => void;
  onDismiss: () => void;
  /** The per-run redaction opt-out (D13), owned by the page. */
  onAllowUnredactedChange: (value: boolean) => void;
}

/**
 * The one prerequisite that is blocking this action, or null.
 *
 * Ordered by what the user has to do first: consent is a decision, a provider is
 * a configuration. Both are stated once, with the action that resolves each.
 */
export function aiReviewBlocker(input: {
  hasConsent: boolean;
  providerConfigured: boolean;
  onOpenSettings: () => void;
}): { message: string; action: string } | null {
  if (!input.hasConsent) {
    return {
      message:
        "AI Review needs its own consent in LLM Settings before any document text can be sent. It is separate from the other review permissions and is not covered by them.",
      action: "Open LLM Settings",
    };
  }
  if (!input.providerConfigured) {
    return {
      message: "No AI provider is configured, so there is nothing to run the review.",
      action: "Open LLM Settings",
    };
  }
  return null;
}

export default function AiReviewSection({
  stage,
  providerConfigured,
  hasConsent,
  providerName,
  preflight,
  progress,
  cancelled,
  result,
  message,
  onOpenSettings,
  onStart,
  onConfirm,
  onCancel,
  onCancelRun,
  onDismiss,
  onAllowUnredactedChange,
}: AiReviewSectionProps): React.ReactNode {
  const blocker = aiReviewBlocker({ hasConsent, providerConfigured, onOpenSettings });

  return (
    <section aria-label="Consistency Review" className="tf-governance-reformat">
      <h2>Consistency Review</h2>
      <p>
        Checks whether different parts of the document disagree with each other — the same figure
        given two values, two different dates for one event, a term used two ways.
      </p>
      <p className="tf-sub">
        This review always covers the whole document at once, because a cross-part comparison over
        part of a document is a different and far less meaningful check. Deterministic governance,
        formatting checks, and safe reformat run on every keystroke and send nothing externally;
        this is the only part of ToneForge that can send document text to a provider. It runs only
        when you choose it, and you can withdraw consent in Settings at any time.
      </p>

      {blocker !== null ? (
        <div role="status" data-testid="ai-review-blocker">
          <p className="tf-debug-warning">{blocker.message}</p>
          <button className="tf-native-button" type="button" onClick={onOpenSettings}>
            {blocker.action}
          </button>
        </div>
      ) : null}

      {message !== null && (
        <p role="alert" data-testid="ai-review-message">
          {message}
        </p>
      )}

      {stage === "idle" ? (
        <button
          className="tf-native-button"
          type="button"
          onClick={onStart}
          disabled={blocker !== null}
          aria-describedby={blocker !== null ? "ai-review-blocker" : undefined}
        >
          Check Consistency
        </button>
      ) : null}

      {stage === "preflight" && preflight !== null ? (
        <ConsistencyReviewPreflight
          approximateWords={preflight.wordCount}
          statementCount={preflight.statementCount}
          maxPerSubject={CONSISTENCY_DEFAULT_MAX_PER_SUBJECT}
          providerName={providerName}
          storageNote={preflight.storageNote}
          allowUnredacted={preflight.allowUnredacted}
          onAllowUnredactedChange={onAllowUnredactedChange}
          onStart={onConfirm}
          onCancel={onCancel}
        />
      ) : null}

      {stage === "running" && progress !== null ? (
        <ConsistencyReviewProgress
          progress={progress}
          cancelled={cancelled}
          onCancel={onCancelRun}
        />
      ) : null}

      {stage === "results" && result !== null ? (
        <ConsistencyReviewResults report={result} onDismiss={onDismiss} />
      ) : null}
    </section>
  );
}
