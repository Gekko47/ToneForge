import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { type WordCapabilities } from "../../word/capabilityProbe";
import { getStructuredSnapshot } from "../../word/documentReader";
import { createRegistryFromSettings } from "../settings/providerComposition";
import type { SpotReviewResult } from "../../ai/review/spotReview";
import {
  createGovernanceProfile,
  type GovernanceProfile,
} from "../../core/domain/GovernanceProfile";
import { createDocumentObserver, type DocumentObserverStatus } from "../../word/documentObserver";
import { createWordParagraphEventAdapter } from "../../word/wordParagraphEvents";
import {
  applyReviewedPlan,
  prepareReformatHost,
  type FullReviewResult,
  type ReformatResult,
} from "../../reformat";
import { consumeTaskpaneTarget } from "../../shared/office/taskpaneNavigation";
import ReformatPanel from "../components/ReformatPanel";
import DebuggingPanel from "../components/DebuggingPanel";
import TaskPaneHeader, { type TaskPaneDestination } from "../components/TaskPaneHeader";
import GovernanceDashboard from "../components/GovernanceDashboard";
import FindingsList from "../components/FindingsList";
import FindingsToolbar from "../components/FindingsToolbar";
import CoverageBanner from "../components/CoverageBanner";
import StaleBanner from "../components/StaleBanner";
import PendingChanges from "../components/PendingChanges";
import AiReviewSection, { type AiReviewStage } from "../components/AiReviewSection";
import {
  previewStatements,
  runConsistencyReview,
  toFindings,
  type ConsistencyProgress,
  type ConsistencyReport,
} from "../../analysis/consistency";
import { findingFingerprint } from "../findingFingerprint";
import {
  createWorkflowState,
  selectCurrentTask,
  selectNextFindingIndex,
  selectPreviousFindingIndex,
  workflowReducer,
} from "../workflow/workflowState";
import { loadState } from "../../core/state/persistence";
import { selectActiveProfile } from "../../core/state/profileSelectors";
import { StyleProfileSchema, type StyleProfile } from "../../core/domain/StyleProfile";
import type { Finding } from "../../core/domain/Finding";
import type { ChangePlan } from "../../core/domain/ChangePlan";
import type { PersistedState } from "../../core/state/persistence";

const Settings = lazy(() => import("./Settings"));
const Profile = lazy(() => import("./Profile"));

const IGNORED_FINDINGS_KEY = "ToneForge.IgnoredFindingFingerprints.v1";

type DashboardPage = "home" | "ai-review" | "profile" | "settings" | "troubleshooting";

function resolveActiveProfile(): StyleProfile | null {
  const profile = selectActiveProfile(loadState());
  return profile ? StyleProfileSchema.parse(profile) : null;
}

export function resolveGovernanceProfile(
  state: PersistedState,
  profile: ReturnType<(typeof StyleProfileSchema)["parse"]>,
): GovernanceProfile {
  const storedProfileId = [state.activeGovernanceProfileId, state.activeProfileId, profile.id].find(
    (id): id is string => id !== null && state.governanceProfiles[id] !== undefined,
  );

  return (
    (storedProfileId === undefined ? undefined : state.governanceProfiles[storedProfileId]) ??
    createGovernanceProfile(profile)
  );
}

type PendingPlan = {
  plan: ChangePlan;
  coverage: {
    complete: boolean;
    unsupported?: readonly string[];
    unprocessed?: readonly string[];
  } | null;
  /** Which review produced this plan. `reformat` is the only one the pane runs today. */
  source: "reformat" | "full" | "spot";
};

function spotPlanCoverage(plan: ChangePlan): {
  complete: boolean;
  unprocessed: string[];
} {
  const unprocessed = plan.changes
    .filter((change) => {
      const finding = plan.findings?.find((item) => item.id === change.findingId);
      return finding === undefined || finding.nodeIds.length === 0;
    })
    .map((change) => change.id);
  return { complete: unprocessed.length === 0, unprocessed };
}

export function resolvePendingPlan(
  reformatResult: ReformatResult | null,
  fullResult: FullReviewResult | null,
  aiReview: SpotReviewResult | null,
): PendingPlan | null {
  if (reformatResult?.plan) {
    return {
      plan: reformatResult.plan,
      coverage: reformatResult.report.coverage ?? null,
      source: "reformat",
    };
  }
  if (fullResult?.plan) {
    return { plan: fullResult.plan, coverage: fullResult.coverage, source: "full" };
  }
  if (aiReview?.plan) {
    return { plan: aiReview.plan, coverage: spotPlanCoverage(aiReview.plan), source: "spot" };
  }
  return null;
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
  // Held in state rather than resolved on every render so a profile created in
  // the first-run editor can be picked up without reloading the task pane. A
  // reload would discard the Office runtime, the capability probe, and the
  // document observer the dashboard already established.
  const [activeProfile, setActiveProfile] = useState<StyleProfile | null>(resolveActiveProfile);

  if (!activeProfile) {
    return (
      <main className="tf-card">
        <h1 className="tf-title">Create a style profile</h1>
        <p className="tf-sub">
          ToneForge needs a style profile before it can analyse or safely reformat this document.
        </p>
        <Suspense fallback={<div role="status">Loading profile editor…</div>}>
          <Profile onBack={() => setActiveProfile(resolveActiveProfile())} />
        </Suspense>
      </main>
    );
  }

  return <DashboardWithProfile key={activeProfile.id} activeProfile={activeProfile} />;
}

function DashboardWithProfile({ activeProfile }: { activeProfile: StyleProfile }): React.ReactNode {
  const [caps, setCaps] = useState<WordCapabilities | null>(null);
  const [page, setPage] = useState<DashboardPage>("home");
  const [findingsOpen, setFindingsOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [reformatResult, setReformatResult] = useState<ReformatResult | null>(null);
  const [status, setStatus] = useState<DocumentObserverStatus | null>(null);
  const [ignoredFindingIds, setIgnoredFindingIds] = useState<Set<string>>(readIgnoredFindingIds);
  const observerRef = useRef<ReturnType<typeof createDocumentObserver> | null>(null);
  // Cross-report consistency review is the only AI review this pane offers. It
  // keeps its own state, its own trigger, and its own consent: collapsing the
  // surface into one section must not let one permission stand in for another.
  // The preflight holds the text it counted, not just the counts. The run sends
  // exactly what the disclosure described, so a second read here would mean the
  // user agreed to send a document that is no longer the one on screen.
  const [consistencyPreflight, setConsistencyPreflight] = useState<{
    wordCount: number;
    statementCount: number;
    text: string;
    /** Section headings, so the engine can attribute statements to sections. */
    sections: string[];
    revision: string;
  } | null>(null);
  const [consistencyProgress, setConsistencyProgress] = useState<ConsistencyProgress | null>(null);
  const [consistencyResult, setConsistencyResult] = useState<ConsistencyReport | null>(null);
  const [consistencyCancelled, setConsistencyCancelled] = useState(false);
  const [consistencyMessage, setConsistencyMessage] = useState<string | null>(null);
  const consistencyAbortRef = useRef<AbortController | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [workflow, dispatchWorkflow] = React.useReducer(
    workflowReducer,
    undefined,
    createWorkflowState,
  );
  const currentTask = selectCurrentTask(workflow);
  const activeProfileKey = `${activeProfile.id}:${activeProfile.revision}`;

  useEffect(() => {
    const phase = status?.phase ?? "notStarted";
    dispatchWorkflow({
      type: "analysis/scan",
      scanStatus: phase === "notStarted" ? "idle" : phase,
    });
    dispatchWorkflow({ type: "analysis/findings", findings: status?.findings ?? [] });
  }, [status]);

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
    const paragraphEvents = createWordParagraphEventAdapter({
      onChange: () => observer.onDocumentChanged(),
    });
    void paragraphEvents.start();
    return () => {
      paragraphEvents.stop();
      observer.stopObserver();
      observerRef.current = null;
    };
  }, [activeProfileKey, caps]);

  useEffect(() => {
    const target = consumeTaskpaneTarget();
    if (!target) return;
    if (target === "debugging") {
      setPage("troubleshooting");
      return;
    }
    if (target === "profile") {
      setPage("profile");
      return;
    }
    if (target === "ai-review") {
      setPage("ai-review");
      return;
    }
    if (target === "findings") {
      setPage("home");
      setFindingsOpen(true);
    }
    if (target === "pending-changes") {
      setPage("home");
      setPendingOpen(true);
    }
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

  function ignoreFinding(finding: Finding): void {
    setIgnoredFindingIds((previous) => new Set(previous).add(findingFingerprint(finding)));
  }

  function navigate(destination: TaskPaneDestination): void {
    setPage(destination);
  }

  /**
   * Open the consistency preflight.
   *
   * The snapshot is taken here and reused for the run so the count shown in the
   * preflight is the count the engine will actually see. Re-reading between the
   * two would let the disclosure describe a document that is no longer the one
   * about to be sent.
   */
  async function openConsistencyPreflight(): Promise<void> {
    setConsistencyMessage(null);
    setConsistencyResult(null);
    setConsistencyCancelled(false);
    const state = loadState();
    if (!state.settings.consistencyReviewConsent) {
      setConsistencyMessage(
        "Cross-report consistency review needs its own consent in Settings. It is not covered by the other review permissions.",
      );
      return;
    }
    const snapshot = await getStructuredSnapshot();
    // Headings are carried into the run text as Markdown headings rather than
    // flattened into the body. `segmentDocument` reads section identity from
    // those markers, so flattening them leaves every statement unattributed:
    // C1 would no longer be able to tell two sections apart, and C9 and the other
    // cross-section checks would have no section to reason about. The `heading`
    // node type is the snapshot's own discriminator, not a guess at a style
    // name.
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
    const wordCount = text.split(/\s+/).filter((word) => word.length > 0).length;
    setConsistencyPreflight({
      wordCount,
      statementCount: previewStatements(text).length,
      text,
      sections,
      // The document's content hash is the run's identity, not its length: an
      // edit that replaces a word with another of the same length leaves the
      // length identical, and a guard keyed on length would report such a run
      // as still current.
      revision: snapshot.contentHash,
    });
    setPage("ai-review");
  }

  async function startConsistencyReview(): Promise<void> {
    if (!consistencyPreflight) return;
    setConsistencyResult(null);
    setConsistencyCancelled(false);
    setConsistencyMessage(null);
    const controller = new AbortController();
    consistencyAbortRef.current = controller;
    setConsistencyProgress({ phase: "segmenting", fraction: 0, message: "Reading the document…" });
    try {
      const state = loadState();
      // Re-checked here, not only at the entry point. Consent can be withdrawn
      // in Settings while the preflight is open, and the engine's own gate is
      // the backstop for that.
      if (!state.settings.consistencyReviewConsent) {
        throw new Error("Cross-report consistency review consent is required in Settings.");
      }
      // The preflight's text, not a fresh read: the disclosure counted this
      // document, so this is the document that was agreed to.
      const { text, sections, revision } = consistencyPreflight;
      const registry = createRegistryFromSettings(state.settings, state.providerConnections);
      const active = registry.activeProvider;
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
          onProgress: setConsistencyProgress,
          // The engine discards its own report if the document moved underneath
          // it; this re-reads the live document's identity to tell it the
          // document moved. Returning the value captured at the start would make
          // the guard answer "unchanged" to every edit, including a same-length
          // one, which is the edit it exists to catch.
          currentRevision: async () => (await getStructuredSnapshot()).contentHash,
        },
      );
      setConsistencyResult(report);
      setConsistencyProgress(null);
    } catch (error: unknown) {
      setConsistencyProgress(null);
      setConsistencyMessage(error instanceof Error ? error.message : String(error));
    } finally {
      consistencyAbortRef.current = null;
    }
  }

  function cancelConsistencyReview(): void {
    consistencyAbortRef.current?.abort();
    setConsistencyCancelled(true);
  }

  async function applyPendingPlan(pendingPlan: PendingPlan | null): Promise<boolean> {
    if (!pendingPlan) return false;
    const { plan, coverage } = pendingPlan;
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
      const currentGovernance = resolveGovernanceProfile(currentState, activeProfile);
      const result = await applyReviewedPlan({
        plan,
        currentGovernancePolicyRevision: currentGovernance.version,
        coverage,
        allowConflictingApply: false,
      });
      if (result.applied && result.verified) {
        setApplyMessage(
          `Applied and verified ${result.results.filter((item) => item.applied).length} change(s).`,
        );
        if (pendingPlan.source === "reformat") setReformatResult(null);
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

  // The consistency report crosses into the ordinary finding model through the
  // same bridge every other engine uses, so the review results can hand its
  // findings to the Findings list rather than to a surface of their own. These
  // produce no change: the planner has no path for a consistency finding until the
  // engine supplies a real correction.
  //
  // Declared above the early return below, and not merely before the composition
  // that uses it: a hook after a conditional return runs on some renders and not
  // others, and React's hook order then differs between them.
  const consistencyFindings = React.useMemo(
    () =>
      consistencyResult === null ? [] : toFindings(consistencyResult, () => crypto.randomUUID()),
    [consistencyResult],
  );

  if (page === "settings" || page === "profile" || page === "troubleshooting") {
    return (
      <main className="tf-card" tabIndex={0}>
        <TaskPaneHeader
          activePage={page}
          profileName={activeProfile.name}
          profileRevision={activeProfile.revision}
          onNavigate={navigate}
        />
        <Suspense fallback={<div role="status">Loading…</div>}>
          {page === "settings" ? (
            <Settings onBack={() => navigate("home")} />
          ) : page === "profile" ? (
            <Profile onBack={() => navigate("home")} />
          ) : (
            <DebuggingPanel onBack={() => navigate("home")} coverage={status?.coverage ?? null} />
          )}
        </Suspense>
      </main>
    );
  }

  const observerFindings = (status?.findings ?? []).filter(
    (finding) => !ignoredFindingIds.has(findingFingerprint(finding)),
  );
  const currentGovernanceFindings = (reformatResult?.report.findings ?? observerFindings).filter(
    (finding) => !ignoredFindingIds.has(findingFingerprint(finding)),
  );
  const findings = [...currentGovernanceFindings, ...consistencyFindings];
  const currentStatus = status;
  const scanPhase = currentStatus?.phase ?? "notStarted";
  const canReviewFindings = scanPhase === "fresh" || scanPhase === "clean";
  // Safe reformat is the only review that can still leave a plan here; the spot
  // and full-document surfaces are retired from the pane. The selector keeps
  // understanding their plans so either could return behind the single section
  // without changing the pending-changes contract.
  const pendingPlan = resolvePendingPlan(reformatResult, null, null);
  const aiSettings = loadState().settings;
  const aiProviderConfigured =
    Boolean(aiSettings.openAiBaseUrl) || aiSettings.llmProvider === "mock";
  const aiReviewConsent = aiSettings.consistencyReviewConsent;
  // Derived rather than stored, so the displayed stage cannot disagree with the
  // state that produced it.
  const aiReviewStage: AiReviewStage =
    consistencyProgress !== null
      ? "running"
      : consistencyResult !== null
        ? "results"
        : consistencyPreflight !== null
          ? "preflight"
          : "idle";

  return (
    <main className="tf-card" tabIndex={0}>
      {/* `page`, not a literal: the header reports the destination the user is
          actually on. Hardcoding "home" here left "Document Governance"
          highlighted while the AI Review page was open. */}
      <TaskPaneHeader
        activePage={page}
        profileName={activeProfile.name}
        profileRevision={activeProfile.revision}
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
            <>
              <FindingsToolbar
                label={currentTask.label}
                nextAction={currentTask.nextAction}
                total={findings.length}
                selectedIndex={workflow.planReview.selectedFindingIndex}
                onPrevious={() =>
                  dispatchWorkflow({
                    type: "plan/selectFinding",
                    index: selectPreviousFindingIndex(workflow),
                  })
                }
                onNext={() =>
                  dispatchWorkflow({
                    type: "plan/selectFinding",
                    index: selectNextFindingIndex(workflow),
                  })
                }
              />
              <FindingsList
                findings={findings}
                onReview={markForReview}
                onIgnore={(findingId) => {
                  const finding = findings.find((item) => item.id === findingId);
                  if (finding) ignoreFinding(finding);
                }}
              />
            </>
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
      {page === "home" && !pendingOpen ? (
        <button
          type="button"
          className="tf-collapsible-header"
          onClick={() => setPendingOpen(true)}
          aria-expanded={false}
        >
          Pending changes <span>{pendingPlan?.plan.changes.length ?? 0}</span>
        </button>
      ) : (
        <section className="tf-collapsible" aria-label="Pending changes section">
          <button
            type="button"
            className="tf-collapsible-header"
            onClick={() => setPendingOpen(false)}
            aria-expanded
          >
            Pending changes <span>{pendingPlan?.plan.changes.length ?? 0}</span>
          </button>
          <PendingChanges
            plan={pendingPlan?.plan ?? null}
            findings={reformatResult?.report.findings ?? currentGovernanceFindings}
            coverage={pendingPlan?.coverage ?? null}
            onApply={() => applyPendingPlan(pendingPlan)}
            onReject={() => {
              setReformatResult(null);
              setPendingOpen(false);
              setApplyMessage("Changes rejected. Nothing was applied to the document.");
            }}
          />
          {applyMessage && <p role="status">{applyMessage}</p>}
        </section>
      )}
      {page === "ai-review" && (
        <AiReviewSection
          stage={aiReviewStage}
          providerConfigured={aiProviderConfigured}
          hasConsent={aiReviewConsent}
          providerName={loadState().settings.llmProvider}
          preflight={
            consistencyPreflight === null
              ? null
              : {
                  wordCount: consistencyPreflight.wordCount,
                  statementCount: consistencyPreflight.statementCount,
                }
          }
          progress={consistencyProgress}
          cancelled={consistencyCancelled}
          result={consistencyResult}
          message={consistencyMessage}
          onOpenSettings={() => setPage("settings")}
          onStart={() => void openConsistencyPreflight()}
          onConfirm={() => void startConsistencyReview()}
          onCancel={() => {
            setConsistencyPreflight(null);
            setConsistencyMessage(null);
          }}
          onCancelRun={cancelConsistencyReview}
          onReviewFindings={() => {
            // Only navigates when the review findings are actually part of the
            // displayed list. Opening a Findings section that does not contain
            // them would show the user their governance findings and read as
            // though the review had been handed over.
            if (consistencyFindings.length === 0) return;
            setPage("home");
            setFindingsOpen(true);
          }}
          onDismiss={() => {
            setConsistencyResult(null);
            setConsistencyPreflight(null);
          }}
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
