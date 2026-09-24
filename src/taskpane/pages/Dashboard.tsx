import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { ThemeProvider } from "@fluentui/react";
import { ThemeProvider as LocalThemeProvider } from "../theme";
import { createDefaultTheme } from "../fluentTheme";
import { probeWordCapabilities, type WordCapabilities } from "../../word/capabilityProbe";
import { probeOfficeRuntime, formatDiagnostics } from "../../shared/office/diagnostics";
import {
  getDocumentSnapshot,
  getSelectedParagraphText,
  getSelectionText,
  getStructuredSnapshot,
} from "../../word/documentReader";
import { createLlmRegistry } from "../../ai/providers/registry";
import { reviewSpot, type SpotReviewResult } from "../../ai/review/spotReview";
import { createGovernanceProfile } from "../../core/domain/GovernanceProfile";
import { createDocumentObserver, type DocumentObserverStatus } from "../../word/documentObserver";
import { applyReviewedPlan, reviewEntireDocument, type FullReviewResult } from "../../reformat";
import { consumeTaskpaneTarget } from "../../shared/office/taskpaneNavigation";
import SmokePanel from "../components/SmokePanel";
import ReformatPanel from "../components/ReformatPanel";
import GovernanceDashboard from "../components/GovernanceDashboard";
import FindingsList from "../components/FindingsList";
import CoverageBanner from "../components/CoverageBanner";
import StaleBanner from "../components/StaleBanner";
import AiReviewEntry from "../components/AiReviewEntry";
import PendingChanges from "../components/PendingChanges";
import AiReviewResult from "../components/AiReviewResult";
import FullReviewPreflight from "../components/FullReviewPreflight";
import FullReviewProgress from "../components/FullReviewProgress";
import FullReviewResults from "../components/FullReviewResults";
import { loadState } from "../../core/state/persistence";
import { StyleProfileSchema } from "../../core/domain/StyleProfile";
import type { Finding } from "../../core/domain/Finding";

const Settings = lazy(() => import("./Settings"));
const Profile = lazy(() => import("./Profile"));

const IGNORED_FINDINGS_KEY = "ToneForge.IgnoredFindingIds";

function resolveActiveProfile(): ReturnType<(typeof StyleProfileSchema)["parse"]> {
  const state = loadState();
  const profile =
    state.profiles.find((item) => item.id === state.activeProfileId) ?? state.profiles[0];
  if (!profile) {
    throw new Error("No style profile found — create one under Style profile first.");
  }
  return StyleProfileSchema.parse(profile);
}

function readIgnoredFindingIds(): Set<string> {
  try {
    const value = window.localStorage.getItem(IGNORED_FINDINGS_KEY);
    const parsed: unknown = value ? JSON.parse(value) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

export default function Dashboard(): React.ReactNode {
  const [caps, setCaps] = useState<WordCapabilities | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [status, setStatus] = useState<DocumentObserverStatus | null>(null);
  const [ignoredFindingIds, setIgnoredFindingIds] = useState<Set<string>>(readIgnoredFindingIds);
  const [activeTarget, setActiveTarget] = useState<string>("governance");
  const observerRef = useRef<ReturnType<typeof createDocumentObserver> | null>(null);
  const [aiReview, setAiReview] = useState<SpotReviewResult | null>(null);
  const [aiReviewBusy, setAiReviewBusy] = useState(false);
  const [aiReviewMessage, setAiReviewMessage] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const [fullPreflight, setFullPreflight] = useState<{
    nodeCount: number;
    wordCount: number;
    protectedCount: number;
  } | null>(null);
  const [fullProgress, setFullProgress] = useState<{
    completed: number;
    total: number;
    partial: boolean;
  } | null>(null);
  const [fullResult, setFullResult] = useState<FullReviewResult | null>(null);
  const fullAbortRef = useRef<AbortController | null>(null);
  const [fullReviewMessage, setFullReviewMessage] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  async function runProbe(): Promise<void> {
    setRunning(true);
    try {
      setCaps(await probeWordCapabilities());
    } finally {
      setRunning(false);
    }
  }

  function runDiagnostics(): void {
    const formatted = formatDiagnostics(probeOfficeRuntime());
    // eslint-disable-next-line no-console
    console.log(formatted);
    setDiag(formatted);
  }

  useEffect(() => {
    const observer = createDocumentObserver({
      debounceMs: 300,
      onStatus: setStatus,
      profile: resolveActiveProfile(),
    });
    observerRef.current = observer;
    observer.startObserver();
    return () => {
      observer.stopObserver();
      observerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const target = consumeTaskpaneTarget();
    if (target) {
      setActiveTarget(target);
      if (target === "ai-review-selection") void runSpotReview("spot_selection");
      if (target === "ai-review-paragraph") void runSpotReview("spot_paragraph");
      if (target === "ai-review-document") void openFullReviewPreflight();
    }
  }, []);

  useEffect(() => {
    getSelectionText()
      .then((text) => setHasSelection(text.trim().length > 0))
      .catch(() => setHasSelection(false));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        IGNORED_FINDINGS_KEY,
        JSON.stringify(Array.from(ignoredFindingIds)),
      );
    } catch {
      // A finding remains ignored for this session when storage is unavailable.
    }
  }, [ignoredFindingIds]);

  function ignoreFinding(id: string): void {
    setIgnoredFindingIds((previous) => new Set(previous).add(id));
  }

  async function runSpotReview(operation: "spot_selection" | "spot_paragraph"): Promise<void> {
    setAiReviewBusy(true);
    setAiReviewMessage(null);
    try {
      const state = loadState();
      if (!state.settings.spotReviewConsent)
        throw new Error("Spot review consent is required in Settings.");
      const selected = await getSelectionText();
      const text =
        operation === "spot_paragraph" && !selected.trim()
          ? await getSelectedParagraphText()
          : selected;
      if (!text?.trim()) throw new Error("Select text or place the cursor in a paragraph first.");
      const profile = resolveActiveProfile();
      const governance =
        state.governanceProfiles[
          state.activeGovernanceProfileId ?? state.activeProfileId ?? profile.id
        ] ?? createGovernanceProfile(profile);
      const snapshot = await getDocumentSnapshot();
      const structured = await getStructuredSnapshot();
      const targetNodeIds = structured.nodes
        .filter((node) => node.text?.includes(text))
        .map((node) => node.nodeId);
      const startOffset = snapshot.text.indexOf(text);
      if (startOffset < 0)
        throw new Error("The selected text is no longer present in the document.");
      const registry = createLlmRegistry({
        provider: state.settings.llmProvider,
        ...(state.settings.llmProvider === "openai"
          ? {
              openai: {
                ...(state.settings.openAiApiKey ? { apiKey: state.settings.openAiApiKey } : {}),
                ...(state.settings.openAiBaseUrl ? { baseUrl: state.settings.openAiBaseUrl } : {}),
                ...(state.settings.openAiModel ? { model: state.settings.openAiModel } : {}),
              },
            }
          : {}),
      });
      const result = await reviewSpot({
        request: {
          id: crypto.randomUUID(),
          operation,
          documentId: snapshot.id,
          documentVersion: snapshot.hash ?? snapshot.id,
          targetNodeIds,
          text,
          profileId: profile.id,
          profileVersion: `${profile.version.major}.${profile.version.minor}.${profile.version.patch}`,
          privacyPolicyId: "spot-minimal-v1",
        },
        profile: governance,
        nodes: structured.nodes,
        includeRawText: true,
        registry,
        rangeOffset: startOffset,
      });
      setAiReview(result);
      setAiReviewMessage(null);
    } catch (error: unknown) {
      setAiReviewMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAiReviewBusy(false);
    }
  }

  async function openFullReviewPreflight(): Promise<void> {
    setFullReviewMessage(null);
    const snapshot = await getStructuredSnapshot();
    const wordCount = snapshot.nodes.reduce(
      (sum, node) => sum + (node.text?.trim().split(/\s+/).filter(Boolean).length ?? 0),
      0,
    );
    setFullPreflight({
      nodeCount: snapshot.nodes.filter((node) => node.editable && !node.protectionReason).length,
      wordCount,
      protectedCount: snapshot.nodes.filter(
        (node) => !node.editable || Boolean(node.protectionReason),
      ).length,
    });
    setActiveTarget("ai-review-document");
  }

  async function startFullReview(): Promise<void> {
    if (!fullPreflight) return;
    setFullResult(null);
    setFullProgress({ completed: 0, total: 1, partial: false });
    const controller = new AbortController();
    fullAbortRef.current = controller;
    try {
      const snapshot = await getStructuredSnapshot();
      const state = loadState();
      const profile = resolveActiveProfile();
      const governance =
        state.governanceProfiles[
          state.activeGovernanceProfileId ?? state.activeProfileId ?? profile.id
        ] ?? createGovernanceProfile(profile);
      const result = await reviewEntireDocument({
        snapshot,
        profile: governance,
        includeRawText: true,
        registry: createLlmRegistry({
          provider: state.settings.llmProvider,
          ...(state.settings.llmProvider === "openai"
            ? {
                openai: {
                  ...(state.settings.openAiApiKey ? { apiKey: state.settings.openAiApiKey } : {}),
                  ...(state.settings.openAiBaseUrl
                    ? { baseUrl: state.settings.openAiBaseUrl }
                    : {}),
                  ...(state.settings.openAiModel ? { model: state.settings.openAiModel } : {}),
                },
              }
            : {}),
        }),
        signal: controller.signal,
        onProgress: (completed, total) => setFullProgress({ completed, total, partial: false }),
      });
      setFullResult(result);
      setFullProgress(null);
      if (result.status === "failed_coverage")
        setFullReviewMessage("Review blocked: required document content is not covered.");
    } catch (error: unknown) {
      setFullReviewMessage(error instanceof Error ? error.message : String(error));
    } finally {
      fullAbortRef.current = null;
    }
  }

  function cancelFullReview(): void {
    fullAbortRef.current?.abort();
    setFullProgress((previous) => (previous ? { ...previous, partial: true } : previous));
  }

  async function applyPendingPlan(): Promise<void> {
    const plan = fullResult?.plan ?? aiReview?.plan ?? null;
    if (!plan) return;
    setApplyMessage(null);
    try {
      const result = await applyReviewedPlan({
        plan,
        allowConflictingApply: plan.conflicts.length > 0,
      });
      if (result.applied) {
        setApplyMessage(
          `Applied ${result.results.filter((item) => item.applied).length} of ${result.results.length} change(s).`,
        );
        observerRef.current?.onDocumentChanged();
      } else {
        setApplyMessage(
          result.results.find((item) => !item.applied)?.error ??
            "Apply refused; preview the changes again.",
        );
      }
    } catch (error: unknown) {
      setApplyMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function markForReview(finding: Finding): void {
    // Phase C provides the entry point. The orchestrator preview owns the
    // actual change-plan and apply flow in the Safe reformat panel below.
    setStatus((previous) =>
      previous
        ? {
            ...previous,
            findings: previous.findings.map((item) =>
              item.id === finding.id ? { ...item, status: "reviewed" } : item,
            ),
          }
        : previous,
    );
  }

  if (showSettings || showProfile) {
    return (
      <Suspense fallback={<div className="tf-card">Loading…</div>}>
        {showSettings ? <Settings /> : <Profile />}
      </Suspense>
    );
  }

  const findings = (status?.findings ?? []).filter((finding) => !ignoredFindingIds.has(finding.id));
  const showFindings = activeTarget === "findings" || activeTarget === "governance";

  return (
    <LocalThemeProvider>
      <ThemeProvider theme={createDefaultTheme()}>
        <main className="tf-card" tabIndex={0}>
          <header>
            <h1 className="tf-title">ToneForge</h1>
            <p>
              {resolveActiveProfile().name} · profile version {resolveActiveProfile().version.major}
              .{resolveActiveProfile().version.minor}.{resolveActiveProfile().version.patch}
            </p>
            <nav aria-label="Task pane sections">
              <button type="button" onClick={() => setActiveTarget("governance")}>
                Document Governance
              </button>
              <button type="button" onClick={() => setActiveTarget("findings")}>
                Findings
              </button>
              <button type="button" onClick={() => setActiveTarget("ai-review-selection")}>
                AI Review
              </button>
              <button type="button" onClick={() => setActiveTarget("pending-changes")}>
                Pending Changes
              </button>
            </nav>
          </header>

          <GovernanceDashboard
            findings={findings}
            lastScan={status?.lastScan ?? null}
            stale={status?.stale ?? false}
            onViewFindings={() => setActiveTarget("findings")}
            onRescan={() => observerRef.current?.onDocumentChanged()}
          />
          <StaleBanner
            stale={status?.stale ?? false}
            lastScan={status?.lastScan ?? null}
            onRescan={() => observerRef.current?.onDocumentChanged()}
          />
          <CoverageBanner coverage={status?.coverage ?? null} />

          {showFindings && (
            <FindingsList findings={findings} onApply={markForReview} onIgnore={ignoreFinding} />
          )}
          {activeTarget === "ai-review-document" &&
            fullPreflight &&
            !fullResult &&
            !fullProgress && (
              <FullReviewPreflight
                nodeCount={fullPreflight.nodeCount}
                approximateWords={fullPreflight.wordCount}
                protectedCount={fullPreflight.protectedCount}
                providerName={loadState().settings.llmProvider}
                onStart={() => void startFullReview()}
                onCancel={() => setActiveTarget("governance")}
              />
            )}
          {activeTarget === "ai-review-document" && fullProgress && (
            <FullReviewProgress
              completed={fullProgress.completed}
              total={fullProgress.total}
              partial={fullProgress.partial}
              onCancel={cancelFullReview}
            />
          )}
          {activeTarget === "ai-review-document" && fullResult && (
            <FullReviewResults
              findings={fullResult.findings}
              plan={fullResult.plan}
              onReviewFindings={() => setActiveTarget("findings")}
              onCreatePlan={() => setActiveTarget("pending-changes")}
            />
          )}
          {fullReviewMessage && <p role="alert">{fullReviewMessage}</p>}
          {activeTarget === "pending-changes" && (
            <>
              <PendingChanges
                plan={fullResult?.plan ?? aiReview?.plan ?? null}
                findings={fullResult?.findings ?? aiReview?.findings ?? findings}
                onApply={applyPendingPlan}
              />
              {applyMessage && <p role="status">{applyMessage}</p>}
            </>
          )}
          {aiReviewBusy && (
            <p role="status" aria-live="polite">
              Reviewing selected context with AI…
            </p>
          )}
          {aiReview && (
            <AiReviewResult
              findings={aiReview.findings}
              plan={aiReview.plan}
              provider={aiReview.provider}
              onPreview={() => setActiveTarget("pending-changes")}
              onDismiss={() => setAiReview(null)}
            />
          )}
          {aiReviewMessage && <p role="alert">{aiReviewMessage}</p>}
          <AiReviewEntry
            supportsSelection={caps?.supportsSelection ?? false}
            supportsParagraphResolution={caps?.supportsParagraphResolution ?? false}
            hasSelection={hasSelection}
            providerConfigured={
              Boolean(loadState().settings.openAiApiKey) ||
              loadState().settings.llmProvider === "mock"
            }
            hasConsent={loadState().settings.spotReviewConsent}
            hasFullDocumentConsent={loadState().settings.fullDocumentReviewConsent}
            onReviewSelection={() => void runSpotReview("spot_selection")}
            onReviewParagraph={() => void runSpotReview("spot_paragraph")}
            onReviewDocument={() => void openFullReviewPreflight()}
            onOpenSettings={() => setShowSettings(true)}
          />
          <section aria-label="Reserved content consistency section">
            <h2>CONTENT CONSISTENCY</h2>
            <p>Reserved for a future phase. No content-consistency engine is active.</p>
          </section>
          <ReformatPanel profile={resolveActiveProfile()} />

          <section aria-label="Diagnostics" style={{ marginTop: "1.5rem" }}>
            <button type="button" onClick={runProbe} disabled={running}>
              {running ? "Probing…" : "Probe Word capabilities"}
            </button>
            <button type="button" onClick={runDiagnostics} style={{ marginLeft: "0.5rem" }}>
              Diagnose Office runtime
            </button>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              style={{ marginLeft: "0.5rem" }}
            >
              Settings
            </button>
            <button
              type="button"
              onClick={() => setShowProfile(true)}
              style={{ marginLeft: "0.5rem" }}
            >
              Style profile
            </button>
            {caps && (
              <pre aria-live="polite" style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(caps, null, 2)}
              </pre>
            )}
            {diag && (
              <pre aria-live="polite" style={{ whiteSpace: "pre-wrap" }}>
                {diag}
              </pre>
            )}
          </section>
          <SmokePanel />
        </main>
      </ThemeProvider>
    </LocalThemeProvider>
  );
}
