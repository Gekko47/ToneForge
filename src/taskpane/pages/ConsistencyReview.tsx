import React from "react";
import AiReviewSection, { type AiReviewStage } from "../components/AiReviewSection";
import { getStructuredSnapshot } from "../../word/documentReader";
import { loadState } from "../../core/state/persistence";
import { createRegistryFromSettings } from "../settings/providerComposition";
import {
  previewStatements,
  runConsistencyReview,
  type ConsistencyProgress,
  type ConsistencyReport,
} from "../../analysis/consistency";

export interface ConsistencyReviewProps {
  onBack: () => void;
  onOpenSettings: () => void;
  /**
   * The finished report, owned by the Dashboard.
   *
   * The report lives above this page because Deterministic Review's findings list
   * shows it too, and that list is on a different tab. Moving the report here
   * would make the handover lose the findings the moment the user navigated to
   * read them, which is the one thing "Review in Findings" must not do.
   */
  result: ConsistencyReport | null;
  /** Receives a finished report, or null once it has been dismissed. */
  onResult: (report: ConsistencyReport | null) => void;
}

/** What the preflight is opened with: the document to be reviewed. */
interface Preflight {
  wordCount: number;
  statementCount: number;
  text: string;
  sections: string[];
  revision: string;
}

/**
 * The Consistency Review tab.
 *
 * This owns the run — the preflight, the progress, the cancellation, and the
 * abort handle — and nothing else. The report itself is deliberately not owned
 * here; see `result` above for why.
 *
 * The consent is checked twice, and both checks are load-bearing. The first
 * refuses before the document is read, so nothing is sent for a review the user
 * has not agreed to. The second refuses again at the moment of sending, because
 * consent can be withdrawn in Settings while the preflight is open, and the
 * engine's own gate is only the backstop for that.
 */
export default function ConsistencyReview({
  onBack,
  onOpenSettings,
  result,
  onResult,
}: ConsistencyReviewProps): React.ReactNode {
  const [preflight, setPreflight] = React.useState<Preflight | null>(null);
  const [progress, setProgress] = React.useState<ConsistencyProgress | null>(null);
  const [cancelled, setCancelled] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const settings = loadState().settings;
  const stage: AiReviewStage =
    progress !== null
      ? "running"
      : result !== null
        ? "results"
        : preflight !== null
          ? "preflight"
          : "idle";

  /**
   * Read the document and show what would be sent.
   *
   * Headings are carried into the run text as Markdown headings rather than
   * flattened into the body. `segmentDocument` reads section identity from those
   * markers, so flattening them leaves every statement unattributed: the
   * cross-section checks would have no section to reason about. `heading` is the
   * snapshot's own discriminator, not a guess at a style name.
   */
  async function openPreflight(): Promise<void> {
    onResult(null);
    setCancelled(false);
    setMessage(null);
    setProgress(null);
    if (!loadState().settings.consistencyReviewConsent) {
      setMessage(
        "Cross-report consistency review needs its own consent in Settings. It is not covered by the other review permissions.",
      );
      return;
    }
    /*
     * Read inside the try, not before it. A host that rejects the read left an
     * unhandled rejection on the click handler, so the page said nothing at
     * all and looked as though the button were inert. `start()` already routes
     * a failure to `message`; the preflight needs the same.
     */
    try {
      const snapshot = await getStructuredSnapshot();
      const sections: string[] = [];
      const blocks = snapshot.nodes.map((node) => {
        const body = node.text ?? "";
        if (node.type !== "heading") return body;
        const title = body.trim();
        if (title.length === 0) return "";
        sections.push(title);
        return `## ${title}`;
      });
      const text = blocks.join("\n\n");
      setPreflight({
        wordCount: text.split(/\s+/).filter((word) => word.length > 0).length,
        statementCount: previewStatements(text).length,
        text,
        sections,
        // The document's content hash is the run's identity, not its length: an
        // edit that replaces a word with another of the same length leaves the
        // length identical, and a guard keyed on length would report such a run
        // as still current.
        revision: snapshot.contentHash,
      });
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Run the review on exactly the document the preflight described.
   *
   * The preflight's text, never a fresh read: the disclosure counted this
   * document, so this is the document that was agreed to.
   */
  async function start(): Promise<void> {
    if (preflight === null) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setCancelled(false);
    setMessage(null);
    setProgress({ phase: "segmenting", fraction: 0, message: "Reading the document…" });
    try {
      const state = loadState();
      if (!state.settings.consistencyReviewConsent) {
        throw new Error("Cross-report consistency review consent is required in Settings.");
      }
      const { text, sections, revision } = preflight;
      const active = createRegistryFromSettings(
        state.settings,
        state.providerConnections,
      ).activeProvider;
      const report = await runConsistencyReview(
        {
          consistencyConsent: true,
          document: { revision, text, sections },
          model: state.settings.openAiModel ?? "",
        },
        {
          // Reused, never re-selected: the consistency engine has no provider
          // picker of its own. The offline stub is passed as no provider at all
          // so the engine reports a deterministic-only run rather than
          // pretending a model was consulted.
          ...(active.name === "mock" ? {} : { provider: active }),
          signal: controller.signal,
          onProgress: setProgress,
          // The engine discards its own report if the document moved underneath
          // it; this re-reads the live document's identity to tell it the
          // document moved. Returning the value captured at the start would make
          // the guard answer "unchanged" to every edit, including a same-length
          // one, which is the edit it exists to catch.
          currentRevision: async () => (await getStructuredSnapshot()).contentHash,
        },
      );
      onResult(report);
      setPreflight(null);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  }

  return (
    <div className="tf-card" data-page="consistency">
      <nav aria-label="Breadcrumb" className="tf-breadcrumbs">
        <button type="button" onClick={onBack}>
          Back to Deterministic Review
        </button>
      </nav>
      <AiReviewSection
        stage={stage}
        providerConfigured={Boolean(settings.openAiBaseUrl) || settings.llmProvider === "mock"}
        hasConsent={settings.consistencyReviewConsent}
        providerName={settings.llmProvider}
        preflight={
          preflight === null
            ? null
            : { wordCount: preflight.wordCount, statementCount: preflight.statementCount }
        }
        progress={progress}
        cancelled={cancelled}
        result={result}
        message={message}
        onOpenSettings={onOpenSettings}
        onStart={() => void openPreflight()}
        onConfirm={() => void start()}
        onCancel={() => {
          setPreflight(null);
          setMessage(null);
        }}
        onCancelRun={() => {
          abortRef.current?.abort();
          setCancelled(true);
        }}
        onReviewFindings={onBack}
        onDismiss={() => onResult(null)}
      />
    </div>
  );
}
