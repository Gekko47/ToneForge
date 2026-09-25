import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { type WordCapabilities } from "../../word/capabilityProbe";
import {
  getDocumentSnapshot,
  getSelectedParagraphText,
  getSelectionText,
  getLiveSelection,
  getStructuredSnapshot,
} from "../../word/documentReader";
import { createLlmRegistry } from "../../ai/providers/registry";
import { reviewSpot, type SpotReviewResult } from "../../ai/review/spotReview";
import { createGovernanceProfile } from "../../core/domain/GovernanceProfile";
import { createDocumentObserver, type DocumentObserverStatus } from "../../word/documentObserver";
import {
  applyReviewedPlan,
  prepareReformatHost,
  reviewEntireDocument,
  type FullReviewResult,
  type ReformatResult,
} from "../../reformat";
import { consumeTaskpaneTarget } from "../../shared/office/taskpaneNavigation";
import ReformatPanel from "../components/ReformatPanel";
import DebuggingPanel from "../components/DebuggingPanel";
import TaskPaneHeader, { type TaskPaneDestination } from "../components/TaskPaneHeader";
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
import { formatProfileVersion, StyleProfileSchema } from "../../core/domain/StyleProfile";
import type { Finding } from "../../core/domain/Finding";

const Settings = lazy(() => import("./Settings"));
const Profile = lazy(() => import("./Profile"));

const IGNORED_FINDINGS_KEY = "ToneForge.IgnoredFindingIds";

type DashboardPage = "home" | "ai-review" | "profile" | "settings" | "troubleshooting";

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
  const [page, setPage] = useState<DashboardPage>("home");
  const [findingsOpen, setFindingsOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [reformatResult, setReformatResult] = useState<ReformatResult | null>(null);
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
  const activeProfile = resolveActiveProfile();
  const activeProfileKey = `${activeProfile.id}:${activeProfile.version.major}:${activeProfile.version.minor}:${activeProfile.version.patch}`;

  useEffect(() => {
    void prepareReformatHost()
      .then(setCaps)
      .catch(() => setCaps(null));
  }, []);

  useEffect(() => {
    const observer = createDocumentObserver({
      debounceMs: 300,
      onStatus: setStatus,
      profile: activeProfile,
      capabilities: caps ?? {
        supportsInsertText: false,
        supportsReplaceText: false,
        supportsInsertParagraph: false,
        supportsInsertBreak: false,
        supportsStyles: false,
        supportsParagraphFormat: false,
        supportsCharacterFormat: false,
        supportsResetCharacterFormatting: false,
        supportsListLevel: false,
        supportsRevisions: false,
        supportsSelection: false,
        supportsParagraphResolution: false,
        supportsHighlight: false,
        supportsContextMenu: false,
        hostName: "unknown",
        hostVersion: null,
      },
    });
    observerRef.current = observer;
    observer.startObserver();
    return () => {
      observer.stopObserver();
      observerRef.current = null;
    };
  }, [activeProfileKey, caps]);

  useEffect(() => {
    const target = consumeTaskpaneTarget();
    if (target) {
      if (target === "debugging") {
        setPage("troubleshooting");
        return;
      }
      if (target === "profile") {
        setPage("profile");
        return;
      }
      if (target.startsWith("ai-review-")) {
        setPage("ai-review");
      }
      if (target === "findings") {
        setPage("home");
        setFindingsOpen(true);
      }
      if (target === "pending-changes") {
        setPage("home");
        setPendingOpen(true);
      }
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

  function navigate(destination: TaskPaneDestination): void {
    setPage(destination);
    setActiveTarget(
      destination === "home"
        ? "governance"
        : destination === "ai-review"
          ? "ai-review-selection"
          : destination,
    );
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
      const liveSelection = operation === "spot_selection" ? await getLiveSelection() : null;
      if (operation === "spot_selection" && liveSelection === null) {
        throw new Error("Live selection start/end identity is unavailable; review was refused.");
      }
      const startOffset =
        liveSelection?.start ?? (snapshot.fullText ?? snapshot.text).indexOf(text);
      if (startOffset < 0 || (liveSelection !== null && liveSelection.text !== text)) {
        throw new Error("The selected text is no longer present in the document.");
      }
      const targetNodes = structured.nodes.filter(
        (node) =>
          node.text?.includes(text) &&
          (node.sourceRange?.startOffset ?? startOffset) <= startOffset &&
          startOffset + text.length <=
            (node.sourceRange?.endOffset ??
              (node.sourceRange?.startOffset ?? startOffset) + text.length),
      );
      if (targetNodes.length !== 1)
        throw new Error("The selected text must resolve to one in-scope review target.");
      const targetNodeIds = targetNodes.map((node) => node.nodeId);
      const registry = createLlmRegistry({
        provider: state.settings.llmProvider,
        ...(state.settings.llmProvider === "openai"
          ? {
              openai: {
                credentialMode: "broker" as const,
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
          documentVersion: snapshot.documentVersion ?? snapshot.fullDocumentHash ?? snapshot.id,
          targetNodeIds,
          text,
          profileId: profile.id,
          profileVersion: formatProfileVersion(profile.version),
          privacyPolicyId: "spot-minimal-v1",
        },
        profile: governance,
        nodes: structured.nodes,
        includeRawText: true,
        consent: { spotReview: true },
        registry,
        rangeOffset: startOffset,
        contentHash: snapshot.fullDocumentHash ?? snapshot.hash ?? snapshot.id,
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
    setPage("ai-review");
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
      if (!state.settings.fullDocumentReviewConsent) {
        throw new Error("Full-document review consent is required in Settings.");
      }
      const profile = resolveActiveProfile();
      const governance =
        state.governanceProfiles[
          state.activeGovernanceProfileId ?? state.activeProfileId ?? profile.id
        ] ?? createGovernanceProfile(profile);
      const result = await reviewEntireDocument({
        snapshot,
        profile: governance,
        includeRawText: true,
        consent: { fullDocumentReview: true },
        registry: createLlmRegistry({
          provider: state.settings.llmProvider,
          ...(state.settings.llmProvider === "openai"
            ? {
                openai: {
                  credentialMode: "broker" as const,
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

  async function applyPendingPlan(): Promise<boolean> {
    const plan = reformatResult?.plan ?? fullResult?.plan ?? aiReview?.plan ?? null;
    if (!plan) return false;
    const coverage = reformatResult?.report.coverage ?? fullResult?.coverage ?? null;
    if (coverage?.complete !== true) {
      setApplyMessage("Apply refused: analysis coverage is incomplete or unavailable.");
      return false;
    }
    if (plan.schemaVersion !== 2) {
      setApplyMessage("Apply refused: preview a schema version 2 plan first.");
      return false;
    }
    if (plan.changes.some((change) => change.precondition === undefined)) {
      setApplyMessage("Apply refused: one or more changes lack exact preconditions.");
      return false;
    }
    if (
      plan.changes.some((change) => change.approvalRequired && change.approvalState !== "approved")
    ) {
      setApplyMessage("Apply refused: one or more changes are still pending approval.");
      return false;
    }
    setApplyMessage(null);
    try {
      const currentState = loadState();
      const currentGovernance =
        currentState.governanceProfiles[
          currentState.activeGovernanceProfileId ?? currentState.activeProfileId ?? activeProfile.id
        ];
      const result = await applyReviewedPlan({
        plan,
        ...(currentGovernance
          ? { currentGovernancePolicyRevision: currentGovernance.version }
          : {}),
        coverage,
        allowConflictingApply: false,
      });
      if (result.applied && result.verified) {
        setApplyMessage(
          `Applied and verified ${result.results.filter((item) => item.applied).length} change(s).`,
        );
        setReformatResult(null);
        setPendingOpen(false);
        observerRef.current?.onDocumentChanged();
        return true;
      }

      setApplyMessage(
        result.verificationError ??
          result.results.find((item) => !item.applied)?.error ??
          "Apply refused; preview the changes again.",
      );
      return false;
    } catch (error: unknown) {
      setApplyMessage(error instanceof Error ? error.message : String(error));
      return false;
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

  if (page === "settings" || page === "profile" || page === "troubleshooting") {
    return (
      <main className="tf-card" tabIndex={0}>
        <TaskPaneHeader
          activePage={page}
          profileName={activeProfile.name}
          profileVersion={`${activeProfile.version.major}.${activeProfile.version.minor}.${activeProfile.version.patch}`}
          onNavigate={navigate}
        />
        <Suspense fallback={<div role="status">Loading…</div>}>
          {page === "settings" ? (
            <Settings onBack={() => navigate("home")} />
          ) : page === "profile" ? (
            <Profile onBack={() => navigate("home")} />
          ) : (
            <DebuggingPanel onBack={() => navigate("home")} />
          )}
        </Suspense>
      </main>
    );
  }

  const observerFindings = (status?.findings ?? []).filter(
    (finding) => !ignoredFindingIds.has(finding.id),
  );
  const currentGovernanceFindings = (reformatResult?.report.findings ?? observerFindings).filter(
    (finding) => !ignoredFindingIds.has(finding.id),
  );
  const findings = currentGovernanceFindings;
  const currentStatus = status;
  const scanPhase = currentStatus?.phase ?? "notStarted";
  const canReviewFindings = scanPhase === "fresh" || scanPhase === "clean";

  return (
    <main className="tf-card" tabIndex={0}>
      <TaskPaneHeader
        activePage="home"
        profileName={activeProfile.name}
        profileVersion={`${activeProfile.version.major}.${activeProfile.version.minor}.${activeProfile.version.patch}`}
        onNavigate={navigate}
      />

      {page === "home" && findingsOpen && (
        <section className="tf-collapsible" aria-label="Findings section">
          <button
            type="button"
            className="tf-collapsible-header"
            onClick={() => setFindingsOpen((open) => !open)}
            aria-expanded={findingsOpen}
          >
            Findings <span>{findings.length}</span>
          </button>
          {findingsOpen && (
            <FindingsList findings={findings} onApply={markForReview} onIgnore={ignoreFinding} />
          )}
        </section>
      )}
      {page === "home" && !findingsOpen && (
        <button
          type="button"
          className="tf-collapsible-header"
          onClick={() => setFindingsOpen(true)}
          aria-expanded={false}
        >
          Findings <span>{findings.length}</span>
        </button>
      )}
      {page === "ai-review" &&
        activeTarget === "ai-review-document" &&
        fullPreflight &&
        !fullResult &&
        !fullProgress && (
          <FullReviewPreflight
            nodeCount={fullPreflight.nodeCount}
            approximateWords={fullPreflight.wordCount}
            protectedCount={fullPreflight.protectedCount}
            providerName={loadState().settings.llmProvider}
            onStart={() => void startFullReview()}
            onCancel={() => {
              setPage("home");
              setActiveTarget("governance");
            }}
          />
        )}
      {page === "ai-review" && activeTarget === "ai-review-document" && fullProgress && (
        <FullReviewProgress
          completed={fullProgress.completed}
          total={fullProgress.total}
          partial={fullProgress.partial}
          onCancel={cancelFullReview}
        />
      )}
      {page === "ai-review" && activeTarget === "ai-review-document" && fullResult && (
        <FullReviewResults
          findings={fullResult.findings}
          plan={fullResult.plan}
          onReviewFindings={() => {
            setPage("home");
            setFindingsOpen(true);
          }}
          onCreatePlan={() => {
            setPage("home");
            setPendingOpen(true);
          }}
        />
      )}
      {page === "ai-review" && fullReviewMessage && <p role="alert">{fullReviewMessage}</p>}
      {page === "home" && !pendingOpen ? (
        <button
          type="button"
          className="tf-collapsible-header"
          onClick={() => setPendingOpen(true)}
          aria-expanded={false}
        >
          Pending changes{" "}
          <span>
            {(reformatResult?.plan ?? fullResult?.plan ?? aiReview?.plan)?.changes.length ?? 0}
          </span>
        </button>
      ) : (
        <section className="tf-collapsible" aria-label="Pending changes section">
          <button
            type="button"
            className="tf-collapsible-header"
            onClick={() => setPendingOpen(false)}
            aria-expanded
          >
            Pending changes{" "}
            <span>
              {(reformatResult?.plan ?? fullResult?.plan ?? aiReview?.plan)?.changes.length ?? 0}
            </span>
          </button>
          <PendingChanges
            plan={reformatResult?.plan ?? fullResult?.plan ?? aiReview?.plan ?? null}
            findings={
              reformatResult?.report.findings ??
              fullResult?.findings ??
              aiReview?.findings ??
              currentGovernanceFindings
            }
            coverage={reformatResult?.report.coverage ?? null}
            onApply={applyPendingPlan}
          />
          {applyMessage && <p role="status">{applyMessage}</p>}
        </section>
      )}
      {page === "ai-review" && aiReviewBusy && (
        <p role="status" aria-live="polite">
          Reviewing selected context with AI…
        </p>
      )}
      {page === "ai-review" && aiReview && (
        <AiReviewResult
          findings={aiReview.findings}
          plan={aiReview.plan}
          provider={aiReview.provider}
          onPreview={() => {
            setPage("home");
            setPendingOpen(true);
          }}
          onDismiss={() => setAiReview(null)}
        />
      )}
      {page === "ai-review" && aiReviewMessage && <p role="alert">{aiReviewMessage}</p>}
      {page === "ai-review" && (
        <AiReviewEntry
          supportsSelection={caps?.supportsSelection ?? false}
          supportsParagraphResolution={caps?.supportsParagraphResolution ?? false}
          hasSelection={hasSelection}
          providerConfigured={
            Boolean(loadState().settings.openAiBaseUrl) ||
            loadState().settings.llmProvider === "mock"
          }
          hasConsent={loadState().settings.spotReviewConsent}
          hasFullDocumentConsent={loadState().settings.fullDocumentReviewConsent}
          onReviewSelection={() => void runSpotReview("spot_selection")}
          onReviewParagraph={() => void runSpotReview("spot_paragraph")}
          onReviewDocument={() => void openFullReviewPreflight()}
          onOpenSettings={() => setPage("settings")}
        />
      )}
      {page === "home" && (
        <section
          className="tf-governance-reformat"
          aria-label="Document governance and safe reformat"
        >
          <GovernanceDashboard
            findings={findings}
            lastScan={status?.lastScan ?? null}
            phase={scanPhase}
            error={status?.error ?? null}
            canReviewFindings={canReviewFindings}
            onViewFindings={() => setFindingsOpen(true)}
            onRescan={() => observerRef.current?.onDocumentChanged()}
          />
          <StaleBanner
            stale={status?.stale ?? false}
            lastScan={status?.lastScan ?? null}
            onRescan={() => observerRef.current?.onDocumentChanged()}
          />
          <CoverageBanner coverage={status?.coverage ?? null} />
          <ReformatPanel
            profile={activeProfile}
            capabilities={caps}
            onPreview={(result) => setReformatResult(result)}
          />
        </section>
      )}

      {caps === null && (
        <p className="tf-sub">
          Host readiness is checked when a review or safe reformat is attempted.
        </p>
      )}
    </main>
  );
}
