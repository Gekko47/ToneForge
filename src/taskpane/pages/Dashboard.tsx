import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { type WordCapabilities } from "../../word/capabilityProbe";
import { getStructuredSnapshot } from "../../word/documentReader";
import { createRegistryFromSettings } from "../settings/providerComposition";
import {
  createGovernanceProfile,
  type GovernanceProfile,
} from "../../core/domain/GovernanceProfile";
import { createDocumentObserver, type DocumentObserverStatus } from "../../word/documentObserver";
import { createWordParagraphEventAdapter } from "../../word/wordParagraphEvents";
import {
  applyReviewedPlan,
  isTrackedEditingEnabled,
  prepareReformatHost,
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
import { usePersistedState } from "../state/usePersistedState";
import { applyReadiness, hostReadinessMessage } from "../settings/applyReadiness";
import { StyleProfileSchema, type StyleProfile } from "../../core/domain/StyleProfile";
import type { Finding } from "../../core/domain/Finding";
import type { ChangePlan } from "../../core/domain/ChangePlan";
import type { PersistedState } from "../../core/state/persistence";

const Settings = lazy(() => import("./Settings"));
const Profile = lazy(() => import("./Profile"));

const IGNORED_FINDINGS_KEY = "ToneForge.IgnoredFindingFingerprints.v1";
const REVIEWED_FINDINGS_KEY = "ToneForge.ReviewedFindingFingerprints.v1";

/** Lets the findings toolbar's `aria-controls` point at the rendered list. */
const FINDINGS_LIST_ID = "tf-findings-list";

type DashboardPage = "home" | "ai-review" | "profile" | "settings" | "troubleshooting";

/** Destinations reachable before a profile exists. */
type SetupDestination = "home" | "settings" | "troubleshooting";

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
};

/**
 * The single plan Pending Changes may offer.
 *
 * Safe reformat is the only review the pane runs, so this takes exactly one
 * result. It previously accepted a full-document result and a spot result that
 * no caller ever passed — both were always `null` at the call site, so two of
 * its three branches were unreachable while still reading as live capability
 * (ADR-0059).
 */
export function resolvePendingPlan(reformatResult: ReformatResult | null): PendingPlan | null {
  if (!reformatResult?.plan) return null;
  return {
    plan: reformatResult.plan,
    coverage: reformatResult.report.coverage ?? null,
  };
}

/**
 * Read a versioned set of finding fingerprints from storage.
 *
 * One reader for both the ignore set and the reviewed set: the parsing and the
 * failure behaviour are identical, and duplicating them is how the two lists end
 * up disagreeing about what a corrupt value means.
 */
function readFingerprintSet(key: string): Set<string> {
  try {
    const value = window.localStorage.getItem(key);
    const parsed: unknown = value ? JSON.parse(value) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function persistFingerprintSet(key: string, ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(ids)));
  } catch {
    // Storage may be unavailable; the set still applies for this session.
  }
}

function readIgnoredFindingIds(): Set<string> {
  return readFingerprintSet(IGNORED_FINDINGS_KEY);
}

function persistIgnoredFindingIds(ids: ReadonlySet<string>): void {
  persistFingerprintSet(IGNORED_FINDINGS_KEY, ids);
}

function persistReviewedFindingIds(ids: ReadonlySet<string>): void {
  persistFingerprintSet(REVIEWED_FINDINGS_KEY, ids);
}

export default function Dashboard(): React.ReactNode {
  // Held in state rather than resolved on every render so a profile created in
  // the first-run editor can be picked up without reloading the task pane. A
  // reload would discard the Office runtime, the capability probe, and the
  // document observer the dashboard already established.
  const [activeProfile, setActiveProfile] = useState<StyleProfile | null>(resolveActiveProfile);

  if (!activeProfile) {
    return <NoProfileSetup onProfileCreated={() => setActiveProfile(resolveActiveProfile())} />;
  }

  return <DashboardWithProfile key={activeProfile.id} activeProfile={activeProfile} />;
}

/**
 * The first-run state, which still has the app frame.
 *
 * This used to render a bare `<main>` with no header, so a user with no profile
 * could not reach Settings, the theme control, or Troubleshooting. That is a
 * real lockout: the AI Review consent lives in Settings, and a user who wants to
 * understand what they are agreeing to before creating a profile had no way to
 * read it. Navigation is available; only the governance actions are not.
 */
function NoProfileSetup({ onProfileCreated }: { onProfileCreated: () => void }): React.ReactNode {
  const [page, setPage] = useState<SetupDestination>("home");

  /*
   * The header offers every destination, so this accepts them all and narrows
   * them. Profile and AI Review need the profile this gate is asking for, so
   * they resolve to home rather than rendering a page that cannot work — the
   * click still does something explainable instead of appearing to do nothing.
   */
  function navigate(destination: TaskPaneDestination): void {
    if (destination === "settings" || destination === "troubleshooting" || destination === "home") {
      setPage(destination);
      return;
    }
    setPage("home");
  }

  if (page === "settings") {
    return (
      <main className="tf-card" tabIndex={0}>
        <TaskPaneHeader
          activePage="settings"
          profileName="None yet"
          profileRevision={0}
          onNavigate={navigate}
        />
        <Suspense fallback={<div role="status">Loading…</div>}>
          <Settings onBack={() => navigate("home")} />
        </Suspense>
      </main>
    );
  }

  if (page === "troubleshooting") {
    return (
      <main className="tf-card" tabIndex={0}>
        <TaskPaneHeader
          activePage="troubleshooting"
          profileName="None yet"
          profileRevision={0}
          onNavigate={navigate}
        />
        <Suspense fallback={<div role="status">Loading…</div>}>
          <DebuggingPanel onBack={() => navigate("home")} coverage={null} />
        </Suspense>
      </main>
    );
  }

  return (
    <main className="tf-card" tabIndex={0}>
      <TaskPaneHeader
        activePage="home"
        profileName="None yet"
        profileRevision={0}
        onNavigate={navigate}
      />
      <h1 className="tf-title">Create a style profile</h1>
      <p className="tf-sub">
        ToneForge needs a style profile before it can analyse or safely reformat this document. You
        can still change Settings and review AI permissions before you create one.
      </p>
      <p className="tf-sub">
        Scanning and applying changes stay unavailable until a profile exists.
      </p>
      <Suspense fallback={<div role="status">Loading profile editor…</div>}>
        <Profile onBack={onProfileCreated} />
      </Suspense>
    </main>
  );
}

function DashboardWithProfile({ activeProfile }: { activeProfile: StyleProfile }): React.ReactNode {
  const [caps, setCaps] = useState<WordCapabilities | null>(null);
  // Persisted state is read through the store, not `loadState()`, so a consent
  // toggle or provider connection saved in Settings is visible here in the same
  // render pass rather than after the user navigates away and back.
  const persisted = usePersistedState();
  const [page, setPage] = useState<DashboardPage>("home");
  const [findingsOpen, setFindingsOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [reformatResult, setReformatResult] = useState<ReformatResult | null>(null);
  const [status, setStatus] = useState<DocumentObserverStatus | null>(null);
  const [ignoredFindingIds, setIgnoredFindingIds] = useState<Set<string>>(readIgnoredFindingIds);
  const [reviewedFindingIds, setReviewedFindingIds] = useState<Set<string>>(() =>
    readFingerprintSet(REVIEWED_FINDINGS_KEY),
  );
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
    const request = consumeTaskpaneTarget();
    if (!request) return;
    if (request.target === "debugging") {
      setPage("troubleshooting");
      return;
    }
    if (request.target === "profile") {
      setPage("profile");
      return;
    }
    if (request.target === "ai-review") {
      setPage("ai-review");
      return;
    }
    if (request.target === "findings") {
      setPage("home");
      setFindingsOpen(true);
    }
    if (request.target === "pending-changes") {
      setPage("home");
      setPendingOpen(true);
    }
    /*
     * "Scan Now" carries its action with it. Opening the governance page and
     * stopping there meant a user who pressed a button labelled "Scan Now" got
     * a page and had to press Scan a second time.
     */
    if (request.action === "scan") {
      observerRef.current?.onDocumentChanged();
    }
  }, []);

  useEffect(() => {
    persistIgnoredFindingIds(ignoredFindingIds);
  }, [ignoredFindingIds]);

  useEffect(() => {
    persistFingerprintSet(REVIEWED_FINDINGS_KEY, reviewedFindingIds);
  }, [reviewedFindingIds]);

  /**
   * Reapply the reviewed set to freshly emitted findings.
   *
   * Without this a reviewed finding reverts to `new` on the next scan, because
   * the observer owns `status` and knows nothing about the user's review marks.
   * Applying the set here keeps the two owners in agreement without the observer
   * needing to know anything about task-pane storage.
   */
  useEffect(() => {
    if (reviewedFindingIds.size === 0) return;
    setStatus((previous) => {
      if (!previous || previous.findings.length === 0) return previous;
      let changed = false;
      const findings = previous.findings.map((item) => {
        if (reviewedFindingIds.has(findingFingerprint(item)) && item.status !== "reviewed") {
          changed = true;
          return { ...item, status: "reviewed" as const };
        }
        return item;
      });
      return changed ? { ...previous, findings } : previous;
    });
  }, [reviewedFindingIds, status]);

  function ignoreFinding(finding: Finding): void {
    setIgnoredFindingIds((previous) => {
      const next = new Set(previous).add(findingFingerprint(finding));
      persistIgnoredFindingIds(next);
      return next;
    });
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

  /**
   * Mark a finding as seen, durably.
   *
   * This used to set `status` on a React copy, which the next observer emission
   * overwrote: a reviewed finding reverted to `new` on the next scan, so the
   * control did nothing. The fingerprint is persisted under the same kind of
   * versioned key the ignore path already uses, and reapplied on every emission
   * so a reviewed finding stays reviewed across rescans.
   */
  function markForReview(finding: Finding): void {
    setReviewedFindingIds((previous) => {
      const next = new Set(previous).add(findingFingerprint(finding));
      persistReviewedFindingIds(next);
      return next;
    });
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
  const pendingPlan = resolvePendingPlan(reformatResult);
  // Read through the store, not `loadState()`: a consent toggle saved in Settings
  // must be reflected here in the same render pass, not after a navigation.
  const aiSettings = persisted.settings;
  const aiProviderConfigured =
    Boolean(aiSettings.openAiBaseUrl) || aiSettings.llmProvider === "mock";
  const aiReviewConsent = aiSettings.consistencyReviewConsent;
  /**
   * One readiness decision, shared by the Apply button and the host banner.
   *
   * Computing it once is the point: two surfaces that each decided readiness
   * separately is how a disabled control and a refusing gate end up disagreeing.
   */
  const readiness = applyReadiness({
    trackedEditingEnabled: isTrackedEditingEnabled(),
    capabilities: caps,
    changes: pendingPlan?.plan.changes ?? [],
  });
  const hostReadiness = hostReadinessMessage({
    trackedEditingEnabled: isTrackedEditingEnabled(),
    capabilities: caps,
  });
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
                listId={FINDINGS_LIST_ID}
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
                id={FINDINGS_LIST_ID}
                findings={findings}
                selectedIndex={workflow.planReview.selectedFindingIndex}
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
            exportCoverage={reformatResult?.report.coverage ?? null}
            applyDisabledReason={readiness.reason}
            onOpenSettings={() => setPage("settings")}
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
          providerName={aiSettings.llmProvider}
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
          {/*
            The host verdict, stated before any preview exists. It used to be a
            footnote saying readiness would be checked later, which told the user
            nothing until after they had clicked Apply.
          */}
          {hostReadiness.verdict !== "ready" && (
            <p
              className={
                hostReadiness.verdict === "blocked"
                  ? "tf-readiness tf-readiness-blocked"
                  : "tf-readiness"
              }
              role="status"
              aria-live="polite"
            >
              {hostReadiness.message}{" "}
              {hostReadiness.verdict === "blocked" && (
                <button type="button" onClick={() => setPage("settings")}>
                  Open Settings
                </button>
              )}
            </p>
          )}
          <StaleBanner
            stale={status?.stale ?? false}
            hostUnavailable={status?.hostUnavailable ?? false}
            lastScan={status?.lastScan ?? null}
            onRescan={() => observerRef.current?.onDocumentChanged()}
          />
          <CoverageBanner coverage={status?.coverage ?? null} />
          {/*
            Safe reformat sits above the findings and pending-changes sections:
            it is the cause of a plan, and the sections it feeds were previously
            rendered above the control that produced them.
          */}
          <ReformatPanel
            profile={activeProfile}
            onPreview={(result) => setReformatResult(result)}
          />
        </section>
      )}
    </main>
  );
}
