import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { type WordCapabilities } from "../../word/capabilityProbe";
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
import {
  consumeTaskpaneTarget,
  type TaskpaneNavigation,
} from "../../shared/office/taskpaneNavigation";
import DebuggingPanel from "../components/DebuggingPanel";
import TaskPaneHeader, { type TaskPaneDestination } from "../components/TaskPaneHeader";
import FindingsList from "../components/FindingsList";
import FindingsToolbar from "../components/FindingsToolbar";
import CoverageBanner from "../components/CoverageBanner";
import StaleBanner from "../components/StaleBanner";
import PendingChanges from "../components/PendingChanges";
import IgnoredFindings from "../components/IgnoredFindings";
import { toFindings, type ConsistencyReport } from "../../analysis/consistency";
import { findingFingerprint } from "../findingFingerprint";
import { isAnyIgnored, withoutIgnored } from "../isIgnoredFinding";
import { decidePreview, isFullScan } from "../autoPreview";
import { reviewFinding, reviewedPlan } from "../reviewGate";
import { reviewKey } from "../reviewKey";
import { describeOpenFindings, summarizeOpenFindings } from "../findingsSummary";
import { reformatDocument } from "../../reformat";
import {
  createWorkflowState,
  selectCurrentTask,
  selectNextFindingIndex,
  selectPreviousFindingIndex,
  workflowReducer,
} from "../workflow/workflowState";
import {
  ignoreFinding as persistIgnore,
  loadState,
  restoreFinding,
} from "../../core/state/persistence";
import { selectActiveProfile } from "../../core/state/profileSelectors";
import { usePersistedState } from "../state/usePersistedState";
import { useAnnouncement } from "../settings/useAnnouncement";
import { deriveAnnouncement } from "../state/announcement";
import { applyReadiness, hostReadinessMessage } from "../settings/applyReadiness";
import { StyleProfileSchema, type StyleProfile } from "../../core/domain/StyleProfile";
import type { Finding } from "../../core/domain/Finding";
import type { ChangePlan } from "../../core/domain/ChangePlan";
import type { PersistedState } from "../../core/state/persistence";

const Settings = lazy(() => import("./Settings"));
const Profile = lazy(() => import("./Profile"));
const GovernancePolicy = lazy(() => import("./GovernancePolicy"));
const ConsistencyReview = lazy(() => import("./ConsistencyReview"));
const Semantic = lazy(() => import("./Semantic"));

const REVIEWED_FINDINGS_KEY = "ToneForge.ReviewedFindingFingerprints.v1";

/** Lets the findings toolbar's `aria-controls` point at the rendered list. */
const FINDINGS_LIST_ID = "tf-findings-list";

type DashboardPage =
  | "home"
  | "consistency"
  | "profile"
  | "semantic"
  | "governance-policy"
  | "settings"
  | "troubleshooting";

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
 * Read a versioned set of review keys from storage.
 *
 * These are strings, not findings, so the shape is a plain string array. The
 * key is rule-plus-position rather than the id, for the reason given on
 * `reviewKey`: the id a user clicks is issued by the observer's run and never
 * reappears in the plan's.
 */
function readReviewedKeys(key: string): Set<string> {
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

function persistReviewedKeys(keys: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(REVIEWED_FINDINGS_KEY, JSON.stringify(Array.from(keys)));
  } catch {
    // Storage may be unavailable; the set still applies for this session.
  }
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
  /**
   * Whether the pane watches the document on its own.
   *
   * Persisted and defaulted on, but previously never read anywhere — the
   * observer started unconditionally, so the setting was a stored intention
   * with no effect. Turning it off now actually stops the automatic scans, and
   * "Re-scan now" is the way back, which is why that control is never
   * disabled by this flag.
   */
  const autoScan = persisted.settings.autoScan;
  const [page, setPage] = useState<DashboardPage>("home");
  /*
   * Open by default, and opened *for* the user when findings arrive.
   *
   * It used to start collapsed, so the pane read "Findings 3" with nothing
   * under it and the user had to know to click. A count with no list beside it
   * is a promise the pane is not keeping. The effect below opens it on the
   * first non-empty scan; the user can still collapse it afterwards, which is
   * the difference between a default and a rule.
   */
  const [findingsOpen, setFindingsOpen] = useState(true);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [reformatResult, setReformatResult] = useState<ReformatResult | null>(null);
  const [status, setStatus] = useState<DocumentObserverStatus | null>(null);
  /*
   * No in-memory set of ignored fingerprints. It was the vehicle for the bug:
   * a fingerprint identifies a *rule*, so a set of them hid every occurrence of
   * an ignored rule. The persisted entries carry the range and are the only
   * source of truth, which is also why the pane needs no effect to mirror them.
   */
  /*
   * Review keys, not finding ids.
   *
   * The id cannot be used: the observer's scan and the preview that builds the
   * plan are separate runs and issue separate uuids, so an id the user clicked
   * would never reappear in the plan and the reviewed-only list could never
   * fill. The key is the rule plus its position, which both runs derive
   * identically. See `reviewKey` for why an ignore tolerates a shifted offset
   * and a review must not.
   */
  const [reviewedKeys, setReviewedKeys] = useState<Set<string>>(() =>
    readReviewedKeys(REVIEWED_FINDINGS_KEY),
  );
  const observerRef = useRef<ReturnType<typeof createDocumentObserver> | null>(null);
  /**
   * The document the held preview was built from.
   *
   * A ref, not state: it is a guard for the auto-preview effect rather than
   * something the user sees, and rendering on it would re-run the very effect
   * that sets it. Reset when the profile changes, because a plan built under
   * one profile cannot answer for another.
   */
  const previewedDocHashRef = useRef<string | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  /**
   * The plan the review gate reads, held in a ref.
   *
   * `pendingPlan` is derived during render, below the early return for the
   * settings and profile pages, so a handler declared above it cannot close over
   * it. A ref is read at click time rather than render time, which is what the
   * gate needs: it must judge against the plan the user is looking at now, not
   * the one present when the handler was created.
   */
  const pendingPlanRef = useRef<PendingPlan | null>(null);
  /** Why a reviewed finding did not become a pending change, if it did not. */
  const [reviewNote, setReviewNote] = useState<string | null>(null);
  /*
   * Coverage starts collapsed, but an *incomplete* analysis overrides that: it
   * is a warning the user has to act on, and hiding it behind a toggle is how
   * a partial analysis comes to be read as a complete one.
   */
  const [coverageOpen, setCoverageOpen] = useState(false);
  const coverageIncomplete = status?.coverage?.complete === false;
  /*
   * The finished consistency report, and nothing else about the review.
   *
   * The run itself — preflight, progress, cancellation, the abort handle — lives
   * on the Consistency Review page. This copy of the report stays here because
   * Document Governance's findings list shows it too, and that list is on a
   * different tab. Keeping the report with the run would drop the findings the
   * moment the user navigated across to read them, which is the one thing
   * "Review in Findings" must not do.
   */
  const [consistencyResult, setConsistencyResult] = useState<ConsistencyReport | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  /*
   * The in-flight flag lives in `PendingChanges`, beside the button it disables.
   *
   * It was duplicated here for a whole-pane "Apply all changes" button that no
   * longer exists. Two copies of one flag are two chances for a button to be
   * enabled while a write is in flight, and the copy guarding the button the
   * user can actually press is the one that has to be right.
   */
  /**
   * One live region for the whole pane.
   *
   * The observer, the apply path, and the consistency review each have their own
   * message, and each of them used to render its own `role="status"` element, so
   * two of them could speak in the same tick. The visible messages stay visible;
   * only the announcement is consolidated here, and the priority order that
   * decides which sentence wins lives in `deriveAnnouncement` where it is
   * testable on its own.
   */
  const announcement = useAnnouncement();
  const [workflow, dispatchWorkflow] = React.useReducer(
    workflowReducer,
    undefined,
    createWorkflowState,
  );
  const currentTask = selectCurrentTask(workflow);
  const activeProfileKey = `${activeProfile.id}:${activeProfile.revision}`;
  /**
   * One host verdict, computed once and read by the banner, the announcement,
   * and the Apply gate alike.
   *
   * Declared here rather than beside the render that shows it, because the
   * announcement effect below needs it and cannot be placed after a conditional
   * return. Three surfaces that each decided readiness separately is how a
   * disabled control and a refusing gate end up disagreeing.
   */
  const hostReadiness = hostReadinessMessage({
    trackedEditingEnabled: isTrackedEditingEnabled(),
    capabilities: caps,
  });
  const hostBlocker = hostReadiness.verdict === "blocked" ? hostReadiness.message : null;

  useEffect(() => {
    const phase = status?.phase ?? "notStarted";
    dispatchWorkflow({
      type: "analysis/scan",
      scanStatus: phase === "notStarted" ? "idle" : phase,
    });
    dispatchWorkflow({ type: "analysis/findings", findings: status?.findings ?? [] });
  }, [status]);

  /**
   * Build the preview automatically once a whole-document scan settles.
   *
   * This replaces the "Preview changes" button, so the gap it closes is real:
   * a user who opened the pane and read their findings could not see what
   * would change without a second action they had to know to take.
   *
   * The decision is delegated to `decidePreview` rather than re-derived here,
   * because the interesting cases are the ones a reader would get wrong — a
   * narrowed scan must not produce a plan, and a plan already held for the
   * current document must not be rebuilt underneath a user reviewing it.
   *
   * `previewing` is a ref rather than state: it only gates this effect, and
   * using state would make setting it re-trigger the effect that sets it.
   *
   * Deliberately NOT gated on `settings.autoScan`. That preference governs
   * *when the pane scans*; this governs what the pane does with a scan that
   * already happened. Gating it would mean a user who turned auto-scan off and
   * pressed "Re-scan now" got a findings list with no Pending Changes and an
   * Apply button that could never enable — a dead end caused by the setting,
   * not by anything about their document.
   */
  const previewingRef = useRef(false);
  useEffect(() => {
    if (status === null) return;
    const decision = decidePreview({
      fullScan: isFullScan(status.coverage),
      // The document identity the *plan* would apply to, which is the scan's
      // own hash rather than the preview's: a plan is only valid for the text
      // it was derived from.
      docHash: status.documentVersion,
      previewedDocHash: previewedDocHashRef.current,
      previewing: previewingRef.current,
    });
    if (decision.kind === "skip") {
      // The narrowed case is the only skip worth telling the user about; the
      // rest are quiet no-ops that would otherwise re-announce on every scan.
      if (!isFullScan(status.coverage)) setPreviewNote(decision.reason);
      return;
    }
    setPreviewNote(null);
    previewingRef.current = true;
    void (async () => {
      try {
        const result = await reformatDocument({
          profile: activeProfile,
          preview: true,
          // Deterministic only. The scan that produced these findings was
          // deterministic too, so letting the model add its own would make the
          // preview describe a document state the findings never saw.
          includeRawText: false,
          policy: resolveGovernanceProfile(persisted, activeProfile),
        });
        // Set the held hash even on a plan with zero changes: an unchanged
        // document is a settled answer, not a reason to re-plan on every scan.
        previewedDocHashRef.current = decision.docHash;
        setReformatResult(result);
        setPendingOpen(true);
      } catch (error: unknown) {
        setApplyMessage(
          `Preview could not be built: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        previewingRef.current = false;
      }
    })();
  }, [status, activeProfile]);

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
        supportsRibbonUpdate: false,
        hostName: "unknown",
        hostVersion: null,
      },
    });
    // A plan built under the previous profile cannot answer for this one, so
    // the auto-preview guard is released here. Otherwise the next scan would
    // see a hash it thinks it has already previewed and build nothing.
    previewedDocHashRef.current = null;
    observerRef.current = observer;
    /*
     * `startObserver` is gated on the preference rather than the observer being
     * created: the observer object itself is what "Re-scan now" drives, so with
     * auto-scan off the pane keeps a handle it can still scan with on demand,
     * and simply does not subscribe to document events. Constructing it and
     * never starting it would make the manual button inert too.
     */
    if (autoScan) observer.startObserver();
    // The change payload is forwarded rather than discarded. It is what lets the
    // observer examine only the paragraphs Word says changed, and it carries the
    // evidence the observer needs to refuse that narrowing when the host did not
    // report a complete set of ids.
    const paragraphEvents = createWordParagraphEventAdapter({
      onChange: (change) => observer.onDocumentChanged(change),
    });
    /*
     * Gated with the observer, not independently.
     *
     * These events are the host's own notification that the text changed, so
     * subscribing to them while auto-scan is off would re-enable exactly the
     * automatic scanning the preference turns off — the setting would appear
     * inert for every host that reports paragraph events, which is every
     * current one.
     */
    if (autoScan) void paragraphEvents.start();
    return () => {
      paragraphEvents.stop();
      observer.stopObserver();
      observerRef.current = null;
    };
    // `autoScan` is a dependency, not a captured value: toggling the setting
    // while the pane is open has to take effect, and without it this effect
    // would never re-run.
  }, [activeProfileKey, caps, autoScan]);

  /*
   * The instruction that arrived with the pane, held so the page that owns the
   * action can read it. Consuming it once here and passing it down keeps the
   * single-consumption guarantee in one place: an effect inside the Semantic
   * page that re-read storage would fire again every time the user navigated
   * back to it.
   */
  const [arrival, setArrival] = useState<TaskpaneNavigation | null>(null);

  useEffect(() => {
    const request = consumeTaskpaneTarget();
    if (!request) return;
    setArrival(request);
    if (request.target === "debugging") {
      setPage("troubleshooting");
      return;
    }
    if (request.target === "semantic") {
      setPage("semantic");
      return;
    }
    if (request.target === "profile") {
      setPage("profile");
      return;
    }
    if (request.target === "governance-policy") {
      setPage("governance-policy");
      return;
    }
    if (request.target === "ai-review") {
      setPage("consistency");
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
    persistReviewedKeys(reviewedKeys);
  }, [reviewedKeys]);

  /*
   * The reviewed set is no longer written back onto `status`.
   *
   * This effect existed because FindingCard read the label from `finding.status`,
   * which the observer rewrites on every scan — so the pane had to patch the
   * observer's data back afterwards. FindingCard now takes the reviewed state as
   * a prop, so the two owners no longer have to be reconciled: the observer
   * owns `status`, and the gate owns what the user reviewed.
   *
   * It also matched on the fingerprint, which is the identity of a rule, so
   * reviewing one em dash marked every em dash in the document reviewed.
   */

  /**
   * Announce the settled state, and only when it actually changed.
   *
   * The observer re-emits on every scan, so without the ref guard the same
   * "Scan complete" sentence would be re-announced on each emission and a
   * screen reader would repeat it for a document nobody changed. Declared above
   * the early return with the rest of the hooks, for the reason the other
   * pre-return declarations give.
   */
  const lastAnnounced = useRef<string | null>(null);
  useEffect(() => {
    const sentence = deriveAnnouncement({
      scanPhase: status?.phase ?? "notStarted",
      findingCount: status?.findings.length ?? 0,
      error: status?.error ?? null,
      applyMessage,
      // A blocked host is announced through the same region. It is a state, not
      // a burst, so it is only spoken when it actually changes. The consistency
      // review's own message belongs to the Consistency Review page, which has
      // its own status region; reading it here would announce it from a tab the
      // user is not on.
      reviewMessage: hostBlocker,
      hostUnavailable: status?.hostUnavailable ?? false,
    });
    if (sentence === lastAnnounced.current) return;
    lastAnnounced.current = sentence;
    if (sentence === null) announcement.clear();
    else announcement.announce(sentence);
  }, [status, applyMessage, hostBlocker, announcement]);

  function ignoreFinding(finding: Finding): void {
    /*
     * Persisted as well as held in component state.
     *
     * The in-memory set is what filters the list, but findings are re-derived
     * on every scan with a fresh uuid, so an ignore that lived only in memory
     * would quietly stop applying the first time the user edited the document —
     * and the finding they set aside would reappear with no explanation.
     * The fingerprint is the identity that survives that, which is why the
     * stored entry is keyed on it.
     */
    persistIgnore({
      fingerprint: findingFingerprint(finding),
      findingId: finding.id,
      category: finding.category,
      message: finding.message,
      range: finding.range,
      nodeIds: finding.nodeIds,
      ignoredAt: new Date().toISOString(),
    });
    // The persisted entry is the whole update. `usePersistedState` re-renders on
    // the save, so there is no second copy to keep in step — and a second copy
    // keyed on fingerprints is exactly what caused the bug this replaces.
  }

  function navigate(destination: TaskPaneDestination): void {
    setPage(destination);
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
        // The revision number alone only proves the plan was built under this
        // policy; the policy is what the protection check reads, so an author's
        // protection override has to travel with it or it stops applying here.
        governanceProfile: currentGovernance,
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
   * Review a finding: either it becomes a pending change, or the pane says why
   * it cannot be one.
   *
   * This replaces a `markForReview` that only flipped a status label, which is
   * why the button appeared to do nothing. The decision is delegated to
   * `reviewGate` so the rule — never announce a change Apply will refuse — is
   * testable without a host, and so the same conditions Apply enforces are the
   * ones the gate reads.
   */
  function reviewOne(finding: Finding): void {
    const decision = reviewFinding(finding, pendingPlanRef.current?.plan ?? null);
    setReviewedKeys((previous) => {
      const next = new Set(previous).add(reviewKey(finding));
      persistReviewedKeys(next);
      return next;
    });
    /*
     * Both outcomes speak through the one pane-wide live region rather than
     * adding a second `role="status"` beside the list. A review that produced no
     * pending change has to say so — otherwise the button looks broken again,
     * which is exactly what the status label-only version of Review did.
     */
    setReviewNote(decision.message);
    announcement.announce(decision.message);
    if (decision.kind === "pending") {
      setPendingOpen(true);
      return;
    }
  }

  /**
   * Re-scan now, whether or not auto-scan is on.
   *
   * Two things have to be reset or the scan is skipped. `previewedDocHashRef`
   * holds the hash the pane has already previewed, and the auto-preview guard
   * compares against it, so a rescan of an unchanged document would build
   * nothing. Any pending plan is dropped too: it was planned against the text
   * as it was, and Apply refuses a plan whose hash no longer matches.
   */
  function rescanNow(): void {
    previewedDocHashRef.current = null;
    setReformatResult(null);
    setPendingOpen(false);
    setReviewNote(null);
    observerRef.current?.onDocumentChanged();
    announcement.announce("Re-scanning the document.");
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

  if (
    page === "settings" ||
    page === "profile" ||
    page === "governance-policy" ||
    page === "consistency" ||
    page === "semantic" ||
    page === "troubleshooting"
  ) {
    const back = () => navigate("home");
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
            <Settings onBack={back} />
          ) : page === "profile" ? (
            <Profile onBack={back} />
          ) : page === "governance-policy" ? (
            <GovernancePolicy onBack={back} />
          ) : page === "consistency" ? (
            <ConsistencyReview
              onBack={back}
              onOpenSettings={() => navigate("settings")}
              result={consistencyResult}
              onResult={setConsistencyResult}
            />
          ) : page === "semantic" ? (
            <Semantic
              onBack={back}
              onOpenSettings={() => navigate("settings")}
              /*
               * Straight through the existing review gate, not a private route
               * into the document. A proposed rewrite therefore meets the same
               * preconditions, the same approval, and the same refusal
               * messages as every other change in the product.
               */
              onSendToPendingChanges={reviewOne}
              navigation={arrival}
            />
          ) : (
            <DebuggingPanel onBack={back} coverage={status?.coverage ?? null} />
          )}
        </Suspense>
      </main>
    );
  }

  /*
   * Filtered with `withoutIgnored` against the *stored* entries, not against an
   * in-memory set of fingerprints.
   *
   * The in-memory set compared fingerprints, and a fingerprint is the identity of
   * a rule rather than of an occurrence — so ignoring one em dash hid every
   * other em dash in the document. The stored entries carry the range, which is
   * what distinguishes the occurrences.
   */
  const observerFindings = withoutIgnored(status?.findings ?? [], persisted.ignoredFindings);
  /*
   * The list is the observer's findings, full stop.
   *
   * This used to read `reformatResult?.report.findings ?? observerFindings`, and
   * that was a latent bug: the preview is a *different* run with its own
   * acquisition and its own rule set, so its findings are not the scan's
   * findings. While the preview only ran on a button press the disagreement was
   * rare and brief. Auto-preview sets it on every full scan, so a preview that
   * found no plannable change replaced a list of three real findings with an
   * empty one — while the toolbar, reading the observer, still said three.
   *
   * The list and the count must come from the same source or the pane
   * contradicts itself, and the observer is the one that scanned the document
   * the user is looking at.
   */
  const findings = [...observerFindings, ...consistencyFindings];
  /*
   * Counted over the list the user can actually see, with the same ignore
   * predicate the filtering above used. Recomputed from `findings` rather than
   * from the observer's raw set, so a finding that is hidden is excluded from
   * every bucket and the two can never disagree.
   */
  // The same matcher the list was filtered with, so a hidden finding cannot be
  // counted and a visible one cannot be missed. Reading the count from a
  // different source than the list is how the two disagreed.
  const openSummary = summarizeOpenFindings(findings, (finding) =>
    isAnyIgnored(finding, persisted.ignoredFindings),
  );
  /*
   * Publish the plan for the review gate to read at click time.
   *
   * Assigned during render rather than in an effect on purpose: an effect would
   * leave the ref holding the *previous* plan for the render in which a handler
   * could first fire, so the gate would judge a finding against a plan the user
   * had already moved on from. Mutating a ref during render is acceptable here
   * because nothing observable is derived from it in this pass.
   */
  /*
   * The plan Pending Changes shows and Apply writes, narrowed to the reviewed
   * findings — and only that.
   *
   * Both the table and `applyPendingPlan` read this same value, so there is no
   * path by which the pane displays one set of changes and writes another. It
   * is also the plan the review gate judges against, for the same reason: a
   * verdict of "added to Pending changes" has to describe what Apply will do.
   *
   * The findings passed are the *preview run's own*. A change's `findingId`
   * names a finding from the run that planned it, so pairing the plan with the
   * observer's list would match nothing and leave Apply permanently empty —
   * safe, but indistinguishable from a broken button.
   */
  const previewFindings = reformatResult?.report.findings ?? [];
  const reviewedOnly = resolvePendingPlan(reformatResult);
  pendingPlanRef.current =
    reviewedOnly === null
      ? null
      : {
          ...reviewedOnly,
          plan: reviewedPlan(reviewedOnly.plan, reviewedKeys, previewFindings) ?? reviewedOnly.plan,
        };
  const pendingPlan = pendingPlanRef.current;
  /**
   * How many changes exist in total, for the collapsed header.
   *
   * The header counts what the user has, not what they have reviewed, so
   * "Pending changes 12" while the open section lists two would look like the
   * other ten had been lost.
   */
  const totalPlannedChanges = reviewedOnly?.plan.changes.length ?? 0;
  const reviewedChangeCount = pendingPlan?.plan.changes.length ?? 0;
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

      {/*
        The pane's only live region. Every message the Dashboard shows elsewhere
        is also spoken from here, so the visible surfaces below are plain text:
        two live regions updating in one tick is how a screen reader ends up
        reading a scan result and an apply refusal in the wrong order.
      */}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement.message}
      </p>

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
              {/*
                The counts lead the list rather than sitting below it. A user
                deciding whether to work through twenty findings needs to know
                how many of them are mandatory before deciding to, not after.
              */}
              <p className="tf-sub">{describeOpenFindings(openSummary)}</p>
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
                reviewedKeys={reviewedKeys}
                onReview={reviewOne}
                onIgnore={(findingId) => {
                  const finding = findings.find((item) => item.id === findingId);
                  if (finding) ignoreFinding(finding);
                }}
              />
              {/*
               * The gate's verdict, in a live region.

               * A review that produced no pending change has to say so. The
               * alternative is a button that appears to do nothing again — which
               * is exactly what the status label-only version of Review did.
               */}
              {reviewNote !== null && <p className="tf-sub">{reviewNote}</p>}
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
          Pending changes <span>{totalPlannedChanges}</span>
        </button>
      ) : (
        <section className="tf-collapsible" aria-label="Pending changes section">
          <button
            type="button"
            className="tf-collapsible-header"
            onClick={() => setPendingOpen(false)}
            aria-expanded
          >
            Pending changes <span>{totalPlannedChanges}</span>
          </button>
          <PendingChanges
            plan={pendingPlan?.plan ?? null}
            unreviewedCount={Math.max(0, totalPlannedChanges - reviewedChangeCount)}
            /*
             * The preview's findings, not the observer's, and deliberately so.
             * Each change carries a `findingId` from the run that planned it, so
             * the annotation is only found in that same run's findings. Passing
             * the observer's would look up ids that were never issued and print
             * every change as unexplained.
             */
            findings={reformatResult?.report.findings ?? findings}
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
          {/* Visible but not live: the pane speaks this from the single region
              above, and a second one here would say it twice. */}
          {applyMessage && <p className="tf-readiness">{applyMessage}</p>}
        </section>
      )}
      {/*
       * Apply All and Re-scan Now, on one row below the findings navigation.
       *
       * Both are decisions about the whole document rather than about the
       * selected finding, so they sit outside the per-card actions: a user
       * stepping through findings should not be offered a button that rewrites
       * all of them. Re-scan Now is always available — it is the only way back
       * to a fresh list when auto-scan is off.
       */}
      {page === "home" && (
        <div className="tf-actions">
          {/*
            Only Re-scan now. The row used to carry an "Apply all changes" button
            that applied the whole plan, which is the exact behaviour the
            reviewed-only list exists to prevent — and it sat beside a Pending
            Changes section that Apply already owned, so the two disagreed about
            what "all" meant. One Apply, in the section that lists what it will
            do, is the only version a user can read before pressing it.
          */}
          <button type="button" onClick={rescanNow} disabled={status?.phase === "scanning"}>
            {status?.phase === "scanning" ? "Re-scanning…" : "Re-scan now"}
          </button>
        </div>
      )}
      {/*
        Page order follows the work: what was found, how complete the analysis
        was, what the user set aside, and only then the change list. Safe
        reformat is gone as a section — it duplicated the findings and pending
        changes above it, and the preview it produced is now built automatically
        by the scan. The tracked-editing control it also owned is a host
        capability toggle and lives in Settings, so `STAGE_01_PASSED` is not
        stranded with nothing able to set it.
      */}
      {page === "home" && (
        <>
          <StaleBanner
            stale={status?.stale ?? false}
            hostUnavailable={status?.hostUnavailable ?? false}
            lastScan={status?.lastScan ?? null}
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
            >
              {hostReadiness.message}{" "}
              {hostReadiness.verdict === "blocked" && (
                <button type="button" onClick={() => setPage("settings")}>
                  Open Settings
                </button>
              )}
            </p>
          )}
          {/*
            Coverage sits directly under the findings because it qualifies them:
            a list drawn from a partial analysis is not a smaller list of
            problems, it is an unknown subset, and it reads as its own warning
            rather than as a footnote on the findings above.
          */}
          {/*
            Collapsible like Findings and Pending changes, and open by default
            only when the scan is incomplete.

            The asymmetry is deliberate: an incomplete analysis is a warning the
            user has to act on, so it stays open; a complete one is a statement
            of fact that has been true since the scan and needs no attention
            until the next scan changes it. The verdict stays readable in the
            collapsed header, so collapsing never hides *whether* it passed —
            only the detail behind it.
          */}
          <CoverageBanner
            coverage={status?.coverage ?? null}
            open={coverageIncomplete || coverageOpen}
            onToggle={() => setCoverageOpen((open) => !open)}
          />
          {/*
            The one thing auto-preview owes the user when it declines: the
            reason, and what would produce a preview instead. Silence here
            would read as "the pane is working" while nothing was planned.
          */}
          {previewNote !== null && <p className="tf-sub">{previewNote}</p>}
        </>
      )}
      {page === "home" && (
        <IgnoredFindings
          entries={persisted.ignoredFindings ?? []}
          onRestore={(fingerprint) => restoreFinding(fingerprint)}
        />
      )}
    </main>
  );
}
