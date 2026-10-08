import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { toAnalysisCapabilities, type WordCapabilities } from "../../word/capabilityProbe";
import type { AnalysisCapabilities } from "../../analysis/analysisContext";
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
  subscribeToTaskpaneTarget,
  type TaskpaneNavigation,
} from "../../shared/office/taskpaneNavigation";
import DebuggingPanel from "../components/DebuggingPanel";
import TaskPaneHeader, { type TaskPaneDestination } from "../components/TaskPaneHeader";
import ReviewWithoutProfile from "./ReviewWithoutProfile";
import FindingsList from "../components/FindingsList";
import FindingsToolbar from "../components/FindingsToolbar";
import { approveGroup, skipGroup } from "../batchApproval";
import CoverageBanner, { scopeLabel } from "../components/CoverageBanner";
import ApplyResultBlock from "../components/ApplyResultBlock";
import StaleBanner from "../components/StaleBanner";
import PendingChanges from "../components/PendingChanges";
import IgnoredFindings from "../components/IgnoredFindings";
import type { ConsistencyReport } from "../../analysis/consistency";
import type { buildCoverage } from "../../analysis/coverage";
import { findingFingerprint } from "../findingFingerprint";
import { isAnyIgnored, withoutIgnored } from "../isIgnoredFinding";
import { decidePreview, isFullScan } from "../autoPreview";
import { reviewFinding, reviewedPlan } from "../reviewGate";
import { approvedIdentities, unapprovableReason } from "../approvalControls";
import type { DeterministicFindingGroup } from "../../analysis/deterministic/contracts";
import {
  clearReviewDecision,
  ensureReviewSession,
  loadReviewSession,
  saveReviewDecision,
} from "../../core/state/reviewSession";
import { reviewIdentity, occurrenceKey } from "../occurrenceIdentity";
import { setupStatusFromState } from "../setupStatus";
import {
  describeCategoryGroups,
  describeOpenFindings,
  summarizeOpenFindings,
} from "../findingsSummary";
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
import type { ApplyOutcome } from "../../reformat/orchestrator";
import type { ChangePlan } from "../../core/domain/ChangePlan";
import type { PersistedState } from "../../core/state/persistence";
import type { SemanticReviewSession } from "../../core/domain/SemanticReviewSession";

const Settings = lazy(() => import("./Settings"));
const Profile = lazy(() => import("./Profile"));
const GovernancePolicy = lazy(() => import("./GovernancePolicy"));
const ConsistencyReview = lazy(() => import("./ConsistencyReview"));
const SemanticReview = lazy(() => import("./SemanticReview"));
const SemanticStyle = lazy(() => import("./SemanticStyle"));
const Home = lazy(() => import("./Home"));

/** Lets the findings toolbar's `aria-controls` point at the rendered list. */
const FINDINGS_LIST_ID = "tf-findings-list";

/**
 * What the pane knows about the host before the probe has answered.
 *
 * Every flag false is the only honest answer here: nothing has been probed, so
 * no capability may be claimed. It is a single shared constant because the
 * alternative — an inline literal at each call site — is how two copies of the
 * same claim drifted apart, one of which then described a Word host that serves
 * every one of these as supporting nothing.
 */
const UNPROBED_CAPABILITIES: AnalysisCapabilities = {
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
  supportsRangedReplacement: false,
  supportsParagraphResolution: false,
  supportsHighlight: false,
  supportsContextMenuApi: false,
  supportsTables: false,
  supportsHeadersFooters: false,
  supportsSections: false,
  hostName: "unknown",
  hostVersion: null,
};

/**
 * The pane's pages. `landing` and `review` are the two that used to be one
 * destination called `home`, which meant the setup checklist and the findings
 * list were the same page and the first run could only show one of them.
 */
type DashboardPage = TaskPaneDestination;

/**
 * Which page this pane opens on.
 *
 * **One pane, more than one page.** Microsoft documents that commands sharing a
 * `<TaskpaneId>` keep "the pane container open but the contents... replaced with
 * the corresponding Action `SourceLocation`" — so `taskpane.html` and
 * `semantic.html` are two **pages of one pane**, not two panes.
 *
 * This prop is the whole of the context menu's navigation. A task pane command
 * runs no JavaScript of ours, so there is nothing that could tell an open pane
 * where to go; the page it loads is the instruction. (ADR-0109, on ADR-0107.)
 */
export type DashboardInitialPage = DashboardPage;

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
  /**
   * The shared coverage report, for the readiness banner.
   *
   * Read from `sharedCoverage` rather than the deterministic report's own
   * `coverage`: this banner is about whether the *plan* can be applied, and the
   * plan gate reads the shared report's `complete` — "no unexpected processing
   * gap" — not the deterministic projection's "every requested scope was
   * examined". Two different questions, and a banner that quoted the wrong one
   * would disagree with the button it explains.
   */
  coverage: ReturnType<typeof buildCoverage> | null;
};

/**
 * The single plan Pending Changes may offer.
 *
 * Safe reformat is the only review the pane runs, so this takes exactly one
 * result. It previously accepted a full-document result and a spot result that
 * no caller ever passed â€” both were always `null` at the call site, so two of
 * its three branches were unreachable while still reading as live capability
 * (ADR-0059).
 */
export function resolvePendingPlan(reformatResult: ReformatResult | null): PendingPlan | null {
  if (!reformatResult?.plan) return null;
  return {
    plan: reformatResult.plan,
    coverage: reformatResult.sharedCoverage,
  };
}

/**
 * The review identities the user has made, read from the store.
 *
 * **Not component state.** Reviews used to be a `Set` in `useState` mirrored into
 * `localStorage` by an effect. The write bypassed `saveState`, so it never
 * notified the store's subscribers, and the pane re-rendered only when something
 * *else* happened to change. That is why a reviewed finding reached Pending
 * Changes only sometimes, and why pressing Re-scan was the reliable way to make
 * it appear: the rescan changed other state, which is what re-rendered the list.
 *
 * Reading from the store makes the write and the render the same event.
 */
function reviewedIdentities(state: PersistedState): ReadonlySet<string> {
  return new Set(
    (state.deterministicReviewSession?.decisions ?? [])
      .filter((entry) => entry.decision === "approved")
      .map((entry) => entry.identity),
  );
}

/**
 * The occurrences the user skipped, read from the review session.
 *
 * A skip is a decision about *this* review, not a permanent set-aside, so it
 * lives in the session (spec §16) and expires with it. Ignore remains the
 * permanent one and keeps its own store.
 */
function skippedIdentities(state: PersistedState): ReadonlySet<string> {
  return new Set(
    (state.deterministicReviewSession?.decisions ?? [])
      .filter((entry) => entry.decision === "skipped")
      .map((entry) => entry.identity),
  );
}

/**
 * The app shell, which renders with or without a profile.
 *
 * **Why this is not a gate.** With no active profile this used to return a
 * `NoProfileSetup` component whose `navigate` collapsed every destination except
 * Settings, Troubleshooting, and home back to home â€” where home *was* the profile
 * editor. The header's other items were therefore visible and inert, and the
 * only way to reach the AI consent, the theme control, or the Semantic tab was
 * to create a profile first. That is a worse first run than an honest one: the
 * user cannot read what they are agreeing to before agreeing to it, and a user
 * whose document is too short to sample had no way to create the blank profile
 * that would unblock them.
 *
 * The prerequisite is unchanged and still enforced â€” scanning and applying need a
 * deterministic profile â€” but it is now stated on the Home page as a warning
 * with a link, rather than enforced by making half the app unreachable.
 */
export interface DashboardProps {
  /** The page this pane opens on. Defaults to the landing page. */
  initialPage?: DashboardInitialPage;
}

export default function Dashboard({ initialPage = "landing" }: DashboardProps): React.ReactNode {
  // Held in state rather than resolved on every render so a profile created in
  // the profile editor can be picked up without reloading the task pane. A
  // reload would discard the Office runtime, the capability probe, and the
  // document observer the dashboard already established.
  const [activeProfile, setActiveProfile] = useState<StyleProfile | null>(resolveActiveProfile);

  if (!activeProfile) {
    return (
      <DashboardWithoutProfile
        onProfileCreated={() => setActiveProfile(resolveActiveProfile())}
        activeProfile={activeProfile}
        initialPage={initialPage}
      />
    );
  }

  return (
    <DashboardWithProfile
      key={activeProfile.id}
      activeProfile={activeProfile}
      initialPage={initialPage}
    />
  );
}

/**
 * The app with no deterministic profile.
 *
 * Every destination is reachable, and each renders its own state rather than
 * being redirected. What the missing profile removes is stated, once, on the
 * Home page, with a link to the control that resolves it.
 *
 * `activeProfile` is passed through rather than resolved again so the parent can
 * swap this component for the full dashboard the moment a profile is created,
 * without a re-render racing the two.
 */
function DashboardWithoutProfile({
  onProfileCreated,
  activeProfile,
  initialPage,
}: {
  onProfileCreated: () => void;
  activeProfile: StyleProfile | null;
  initialPage: DashboardInitialPage;
}): React.ReactNode {
  const [page, setPage] = useState<DashboardPage>(initialPage);
  const persisted = usePersistedState();
  const status = setupStatusFromState(persisted);

  function navigate(destination: TaskPaneDestination): void {
    setPage(destination);
  }

  const header = (
    <TaskPaneHeader
      activePage={page}
      profileName={activeProfile?.name ?? "None yet"}
      profileRevision={activeProfile?.revision ?? 0}
      onNavigate={navigate}
    />
  );

  const back = () => navigate("landing");

  /**
   * Leaving the profile editor with no profile still returns to the checklist.
   *
   * `onProfileCreated` alone is not enough. It re-resolves the active profile and
   * calls `setActiveProfile(null)`, which is the value the state already holds, so
   * React bails out of the re-render and this component never re-renders to
   * restore its own `page` state. The user is left on the editor with the header
   * as the only way out — the same lockout S1 removed, reintroduced through the
   * back button. Navigating here is what makes "Back" mean back.
   */
  function leaveProfileEditor(): void {
    onProfileCreated();
    navigate("landing");
  }

  if (page === "settings") {
    return (
      <main className="tf-card" tabIndex={0}>
        {header}
        <Suspense fallback={<div role="status">Loadingâ€¦</div>}>
          <Settings onBack={back} />
        </Suspense>
      </main>
    );
  }

  if (page === "troubleshooting") {
    return (
      <main className="tf-card" tabIndex={0}>
        {header}
        <Suspense fallback={<div role="status">Loadingâ€¦</div>}>
          <DebuggingPanel onBack={back} coverage={null} />
        </Suspense>
      </main>
    );
  }

  if (page === "profile") {
    return (
      <main className="tf-card" tabIndex={0}>
        {header}
        <Suspense fallback={<div role="status">Loading profile editorâ€¦</div>}>
          <Profile onBack={leaveProfileEditor} />
        </Suspense>
      </main>
    );
  }

  /*
   * Semantic Style, reached with no deterministic profile.
   *
   * The two semantic pages are routable with no active style profile at all —
   * that is precisely when a user needs to learn one — so this branch is here
   * as well as in the profiled dashboard below. It used to live only in the
   * profiled branch, which made the one page that can create a profile the one
   * page you could not reach without already having one.
   */
  if (page === "semantic-style") {
    return (
      <main className="tf-card" tabIndex={0}>
        {header}
        <Suspense fallback={<div role="status">Loadingâ€¦</div>}>
          <SemanticStyle
            onBack={() => navigate("semantic-review")}
            onOpenSettings={() => navigate("settings")}
          />
        </Suspense>
      </main>
    );
  }

  if (page === "semantic-review") {
    return (
      <main className="tf-card" tabIndex={0}>
        {header}
        <Suspense fallback={<div role="status">Loading</div>}>
          <SemanticReview
            /*
             * To Deterministic Review, not to the shared `back`.
             *
             * The breadcrumb on this page reads "Back to Deterministic Review",
             * and `back` in this dashboard is `navigate("landing")`. Passing it
             * would make that label a lie: the user presses Back to Deterministic
             * Review and arrives at the setup checklist, which is exactly the
             * report this phase fixes. The profiled dashboard already uses
             * `navigate("review")` here; this branch now says the same thing.
             */
            onBack={() => navigate("review")}
            onOpenSettings={() => navigate("settings")}
            onOpenSemanticStyle={() => navigate("semantic-style")}
            session={null}
            onSession={() => undefined}
          />
        </Suspense>
      </main>
    );
  }

  /*
   * Deterministic Review, reached with no deterministic profile.
   *
   * These two branches and the page behind them exist because `review` and
   * `semantic-review` had none, and everything without one fell through to Home.
   * Choosing either destination, or arriving on Semantic Review and pressing Back,
   * landed on the setup checklist, which is indistinguishable from the press doing
   * nothing. Reported from a real Word as the two pages being stuck on Home.
   *
   * Semantic Review is not gated on a deterministic profile at all, so it renders
   * the real page. Deterministic Review has nothing to render without one, so it
   * states that and names the control that resolves it.
   */
  if (page === "review") {
    return (
      <main className="tf-card" tabIndex={0}>
        {header}
        <Suspense fallback={<div role="status">Loading</div>}>
          <ReviewWithoutProfile onBack={back} onOpenProfile={() => navigate("profile")} />
        </Suspense>
      </main>
    );
  }
  if (page === "consistency") {
    return (
      <main className="tf-card" tabIndex={0}>
        {header}
        <Suspense fallback={<div role="status">Loadingâ€¦</div>}>
          <ConsistencyReview
            onBack={back}
            onOpenSettings={() => navigate("settings")}
            result={null}
            onResult={() => undefined}
          />
        </Suspense>
      </main>
    );
  }

  if (page === "governance-policy") {
    return (
      <main className="tf-card" tabIndex={0}>
        {header}
        <Suspense fallback={<div role="status">Loadingâ€¦</div>}>
          <GovernancePolicy onBack={back} />
        </Suspense>
      </main>
    );
  }

  return (
    <main className="tf-card" tabIndex={0}>
      {header}
      <Suspense fallback={<div role="status">Loadingâ€¦</div>}>
        <Home setup={status} onNavigate={navigate} onProfileCreated={onProfileCreated} />
      </Suspense>
    </main>
  );
}

function DashboardWithProfile({
  activeProfile,
  initialPage,
}: {
  activeProfile: StyleProfile;
  initialPage: DashboardInitialPage;
}): React.ReactNode {
  const [caps, setCaps] = useState<WordCapabilities | null>(null);
  // Persisted state is read through the store, not `loadState()`, so a consent
  // toggle or provider connection saved in Settings is visible here in the same
  // render pass rather than after the user navigates away and back.
  const persisted = usePersistedState();
  /**
   * Whether the pane watches the document on its own.
   *
   * Persisted and defaulted on, but previously never read anywhere â€” the
   * observer started unconditionally, so the setting was a stored intention
   * with no effect. Turning it off now actually stops the automatic scans, and
   * "Re-scan now" is the way back, which is why that control is never
   * disabled by this flag.
   */
  const autoScan = persisted.settings.autoScan;
  const activeGovernanceProfile = resolveGovernanceProfile(persisted, activeProfile);
  const [page, setPage] = useState<DashboardPage>(
    initialPage === "landing" ? "review" : initialPage,
  );
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
  /**
   * Review identities, derived from the store on every render.
   *
   * Not component state, and that is the fix. Reviews were a `Set` in
   * `useState` written straight to `localStorage` by an effect, which meant the
   * write never notified the store's subscribers â€” the pane re-rendered only
   * when something else happened to change. A reviewed finding therefore reached
   * Pending Changes only sometimes, and the reliable way to make it appear was
   * to press Re-scan, which changed other state. Deriving from `persisted`
   * makes the write and the re-render the same event.
   */
  const reviewedKeys = reviewedIdentities(persisted);
  /*
   * Skipped occurrences, kept apart from the approved set.
   *
   * Spec §15: Approve means "include this correction in the reviewed plan" and
   * Skip means "exclude this occurrence from the current review". They are
   * different decisions, so they cannot share one set — a skip recorded in the
   * approved set would put a change the user declined into the document.
   */
  const skippedKeys = skippedIdentities(persisted);
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
  /**
   * The *unfiltered* preview plan, for the review gate to judge a finding
   * against.
   *
   * Separate from `pendingPlanRef` because the two answer different questions.
   * `pendingPlan` is what the user has already agreed to and is all Apply may
   * write; this is everything the preview proposed. A finding under review is,
   * by definition, not in the first one â€” resolving it against the narrowed
   * plan meant the gate answered "the planner proposes no correction" for a
   * finding that had one, and reviewing the first finding could never add
   * anything.
   */
  const previewPlanRef = useRef<ChangePlan | null>(null);
  /** The preview run's own findings, matched to a reviewed finding by key. */
  const previewFindingsRef = useRef<readonly Finding[]>([]);
  /** Why a reviewed finding did not become a pending change, if it did not. */
  const [reviewNote, setReviewNote] = useState<string | null>(null);
  const [expiredDecisionCount, setExpiredDecisionCount] = useState(0);
  /*
   * Coverage starts collapsed, but an *incomplete* analysis overrides that: it
   * is a warning the user has to act on, and hiding it behind a toggle is how
   * a partial analysis comes to be read as a complete one.
   */
  const [coverageOpen, setCoverageOpen] = useState(false);
  /*
   * The verdict comes from the deterministic projection, not the shared report.
   *
   * `CoverageReport.complete` says whether *acquisition* read everything, which
   * is a different question from whether the *review* examined everything: the
   * shared report has no requested-versus-examined list, and a body-only scan
   * with a perfect acquisition reads as complete in it. Spec §9 asks about the
   * review, and §27 gate 12 is a gate on the claim the user reads.
   */
  const coverageIncomplete =
    status?.deterministicCoverage !== null &&
    status?.deterministicCoverage !== undefined &&
    !status.deterministicCoverage.complete;
  /*
   * The scopes a blocker names, shown again outside the collapsible banner.
   *
   * Not a filter on the findings list: a mandatory scope that was not examined
   * has, by definition, no findings, so there is nothing in the list to filter to.
   * What the reader needs is the reason, which the banner already carries — and
   * this repeat exists so a collapsed banner never hides it.
   *
   * Derived from the current coverage report rather than stored. It used to be
   * written only by `onRescan`, so a scope the new scan had resolved, or that the
   * policy no longer required, stayed on screen for the rest of the session: the
   * note named blockers the run no longer had.
   */
  const remainingScopes = [
    ...new Set((status?.deterministicCoverage?.blockers ?? []).map((blocker) => blocker.scope)),
  ];
  /**
   * The post-apply result block (spec §19).
   *
   * State rather than a field on `reformatResult` because the block has to
   * outlive the plan: the plan is cleared on success so Pending Changes empties,
   * but the user still has to decide whether to keep each tracked revision. A
   * result attached to the plan would disappear at the moment it became useful.
   */
  const [applyOutcome, setApplyOutcome] = useState<ApplyOutcome | null>(null);
  const [applyResultOpen, setApplyResultOpen] = useState(false);
  /*
   * The finished consistency report, and nothing else about the review.
   *
   * The run itself â€” preflight, progress, cancellation, the abort handle â€” lives
   * on the Consistency Review page. This copy of the report stays here because
   * Deterministic Review's findings list shows it too, and that list is on a
   * different tab. Keeping the report with the run would drop the findings the
   * moment the user navigated across to read them, which is the one thing
   * "Review in Findings" must not do.
   */
  const [consistencyResult, setConsistencyResult] = useState<ConsistencyReport | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  /*
   * What Semantic Review is currently holding, for the Troubleshooting panel.
   *
   * Held here rather than on the page because the surface that needs it is a
   * different one: by the time anyone reads Troubleshooting, the review page has
   * been unmounted, and a greyed-out Apply or Review has no explanation left on
   * screen. `null` is distinct from `false` — the page not having been opened is
   * not a fault, and reporting it as one would put a blocker on a panel that has
   * none.
   *
   * One state, not two. The characters and the refusal both come from a single
   * `onReviewStatus` call, so splitting them would create two copies of one
   * event and a way for them to disagree about whether a review is on screen.
   */
  const [semanticReviewStatus, setSemanticReviewStatus] = useState<{
    heldChars: number | null;
    preservationRefused: boolean;
  } | null>(null);
  /*
   * The semantic review session, held above the page.
   *
   * A review costs a provider call and takes as long as the model takes, so
   * discarding it because the user visited Settings — the page whose whole purpose
   * is consent and provider configuration — would make the one page that most
   * often needs a fix the one that throws the work away. Held here for the same
   * reason `consistencyResult` is: the run lives on its page, the report lives
   * above it.
   */
  const [semanticSession, setSemanticSession] = useState<SemanticReviewSession | null>(null);
  /*
   * Back to "not established" when the tab is left — but not for Troubleshooting.
   *
   * The flag describes what the Semantic page is holding right now, and it is
   * unmounted the moment the user navigates away. Leaving the last answer in
   * place on an unrelated page would be meaningless, but Troubleshooting is the
   * page whose entire purpose is to report this flag: clearing it on arrival
   * meant the panel the user opened to find out why Apply was greyed out always
   * answered "not established", and the state had to survive being observed.
   */
  useEffect(() => {
    if (page === "semantic-review" || page === "semantic-style" || page === "troubleshooting") {
      return;
    }
    setSemanticReviewStatus(null);
  }, [page]);
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
   * because the interesting cases are the ones a reader would get wrong â€” a
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
   * Apply button that could never enable â€” a dead end caused by the setting,
   * not by anything about their document.
   */
  const previewingRef = useRef(false);
  /**
   * The narrowed run the full-rescan follow-up was already requested for.
   *
   * A ref, not state: it is a guard for the preview effect rather than anything
   * the user sees, and rendering on it would re-trigger the effect that sets it.
   */
  const narrowFollowUpRef = useRef<string | null>(null);
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
      /*
       * A narrowed scan cannot produce a whole-document plan, so the preview is
       * declined â€” and without this the previous plan simply sat there
       * describing text that no longer existed, which reads as "the pane stopped
       * updating". Rather than build a plan from a partial read, ask the observer
       * for the full scan that can.
       *
       * Once per narrowed run: the follow-up is itself a full scan, so the
       * `isFullScan` guard above stops the next attempt. The ref is the belt to
       * that braces, so a host that keeps reporting a narrow scope cannot spin
       * the observer.
       */
      if (!isFullScan(status.coverage)) {
        setPreviewNote(decision.reason);
        if (narrowFollowUpRef.current !== status.documentVersion) {
          narrowFollowUpRef.current = status.documentVersion;
          observerRef.current?.onDocumentChanged();
        }
      }
      return;
    }
    narrowFollowUpRef.current = null;
    setPreviewNote(null);
    previewingRef.current = true;
    void (async () => {
      try {
        const result = await reformatDocument({
          profile: activeProfile,
          preview: true,
          // Deterministic only. The scan that produced these findings was
          // deterministic too, and this path has no provider parameter at all
          // — spec §3.2 moved semantic review out of the reformat pipeline.
          policy: resolveGovernanceProfile(persisted, activeProfile),
          /*
           * The probed capabilities, not a fallback.
           *
           * This call passed no `capabilities`, so the orchestrator used
           * `FALLBACK_CAPABILITIES` — every flag false — and the preview
           * therefore planned against a host that supports nothing. That is
           * what put `styles, styleBuiltin, isListItem, listItem, alignment,
           * lineSpacing, spaceAfter, spaceBefore, font` in the unsupported list
           * of a report describing a Word host that serves all of them. The
           * pane was asserting its own ignorance rather than the host's.
           *
           * `caps` is `null` until the probe resolves, and the observer already
           * handles that with the same all-false set, so preview and scan can
           * never disagree about what the host offers.
           */
          ...(caps === null ? {} : { capabilities: toAnalysisCapabilities(caps) }),
        });
        /*
         * The held hash is claimed only once the host has been probed.
         *
         * A preview built before the probe answered planned against a host that
         * supports nothing, so it is provisional by construction. Claiming the
         * hash for it would make `decidePreview` treat the document as already
         * previewed, and the corrected plan would never be built — the fallback
         * would be permanent rather than momentary. Waiting costs one extra
         * planning pass per document and removes a class of wrong report.
         *
         * Zero changes still claims the hash once capabilities are known: an
         * unchanged document is a settled answer, not a reason to re-plan on
         * every scan.
         */
        if (caps !== null) previewedDocHashRef.current = decision.docHash;
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
    // `caps` is a dependency so the corrected preview runs when the probe
    // lands. It is compared by identity, and `setCaps` receives one object per
    // probe, so this re-runs once per probe rather than per render.
  }, [status, activeProfile, caps]);

  useEffect(() => {
    void prepareReformatHost()
      .then(setCaps)
      .catch(() => setCaps(null));
  }, []);

  useEffect(() => {
    const observer = createDocumentObserver({
      // No `debounceMs`: the observer's own default is the single place this is
      // decided, and a second copy here is one more number to forget to change.
      onStatus: (nextStatus) => {
        const acceptedPhase =
          nextStatus.phase === "fresh" ||
          nextStatus.phase === "clean" ||
          nextStatus.phase === "incomplete";
        if (acceptedPhase && nextStatus.reviewSessionIdentity !== null) {
          const previousSession = loadReviewSession();
          const { invalidatedBy } = ensureReviewSession(nextStatus.reviewSessionIdentity);
          if (invalidatedBy.length > 0) {
            const expiredCount = previousSession?.decisions.length ?? 0;
            setExpiredDecisionCount(expiredCount);
            if (expiredCount > 0) {
              setReviewNote(
                `${expiredCount} review decision${expiredCount === 1 ? "" : "s"} expired because the document, profile, governance policy, or checked scope changed. Review the findings again.`,
              );
            }
          }
        }
        setStatus(nextStatus);
      },
      profile: activeProfile,
      policy: activeGovernanceProfile,
      capabilities: caps === null ? UNPROBED_CAPABILITIES : toAnalysisCapabilities(caps),
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
     * automatic scanning the preference turns off â€” the setting would appear
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
  }, [activeProfileKey, activeGovernanceProfile.version, caps, autoScan]);

  /*
   * The instruction that arrived with the pane, held so the page that owns the
   * action can read it. Consuming it once here and passing it down keeps the
   * single-consumption guarantee in one place: an effect inside the Semantic
   * page that re-read storage would fire again every time the user navigated
   * back to it.
   */
  const [arrival, setArrival] = useState<TaskpaneNavigation | null>(null);

  useEffect(() => {
    /**
     * Act on one command.
     *
     * Shared by mount-time consumption and the live subscription, so a command
     * that arrives after the pane is open behaves exactly like one that opened
     * it. Two copies of this mapping is how the `governance` target came to be
     * unhandled: the rename changed the destination, this table kept the old
     * name, and "Scan Now" ran its scan and opened nothing.
     */
    function applyArrival(request: TaskpaneNavigation): void {
      setArrival(request);
      switch (request.target) {
        case "debugging":
          setPage("troubleshooting");
          return;
        /*
         * One command, and it opens Review — not Style.
         *
         * The command reads the selection on arrival, and a selection has no
         * meaning on the style page: the whole reason to arrive from the context
         * menu is to review *this text*, so opening the editor that learns a
         * voice would throw away the gesture that brought the user here.
         */
        case "semantic-review":
          setPage("semantic-review");
          return;
        case "profile":
          setPage("profile");
          return;
        case "governance-policy":
          setPage("governance-policy");
          return;
        case "ai-review":
          setPage("consistency");
          return;
        case "findings":
          setPage("review");
          setFindingsOpen(true);
          break;
        case "pending-changes":
          setPage("review");
          setPendingOpen(true);
          break;
        case "review":
          setPage("review");
          break;
      }
      /*
       * "Scan Now" carries its action with it. Opening the review page and
       * stopping there meant a user who pressed a button labelled "Scan Now" got
       * a page and had to press Scan a second time.
       */
      if (request.action === "scan") {
        observerRef.current?.onDocumentChanged();
      }
    }

    /*
     * Whatever opened the pane, acted on now.
     *
     * A command that was pressed before the pane loaded left its instruction in
     * storage, and this is the only thing that ever read it.
     */
    const pending = consumeTaskpaneTarget();
    if (pending !== null) applyArrival(pending);

    /*
     * And a command pressed while the pane is already open.
     *
     * Consumed only on mount before, so a ribbon or context-menu command used
     * after the pane had loaded wrote its instruction and nothing read it — the
     * button did nothing, silently, and the next mount picked up a stale
     * instruction from whenever the user happened to reopen the pane. The
     * commands run in a different document, which is the case `storage` events
     * exist for.
     */
    return subscribeToTaskpaneTarget(applyArrival);
  }, []);

  /*
   * The reviewed set is no longer written back onto `status`.
   *
   * This effect existed because FindingCard read the label from `finding.status`,
   * which the observer rewrites on every scan â€” so the pane had to patch the
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
     * would quietly stop applying the first time the user edited the document â€”
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
      occurrenceKey: occurrenceKey(finding),
    });
    // The persisted entry is the whole update. `usePersistedState` re-renders on
    // the save, so there is no second copy to keep in step â€” and a second copy
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
        // The profile and capabilities travel so the post-apply refresh runs
        // the *same* review under the *same* policy the plan was built from. A
        // refresh under different conditions is not evidence about this document.
        profile: activeProfile,
        capabilities: caps ? toAnalysisCapabilities(caps) : UNPROBED_CAPABILITIES,
      });
      /*
       * The result block is set on every path, including the refusals.
       *
       * A refused apply is a result too, and its counts are how the pane says
       * "0 of 4" rather than showing a message with nothing to attach it to. The
       * block opens only when something went wrong, so a clean apply does not
       * interrupt the flow of approving the next finding.
       */
      setApplyOutcome(result.outcome);
      if (result.applied && result.verified) {
        setApplyResultOpen(result.outcome.unverifiedCount > 0 || result.outcome.failedCount > 0);
        setApplyMessage(
          `Applied and verified ${result.results.filter((item) => item.applied).length} change(s).`,
        );
        setReformatResult(null);
        setPendingOpen(false);
        observerRef.current?.onDocumentChanged();
        return true;
      }

      setApplyResultOpen(true);
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
   * `reviewGate` so the rule â€” never announce a change Apply will refuse â€” is
   * testable without a host, and so the same conditions Apply enforces are the
   * ones the gate reads.
   */
  function reviewOne(finding: Finding): void {
    /*
     * Judged against the *preview run's* plan and that run's own findings.
     *
     * The finding in front of the user comes from the observer's scan; the plan
     * comes from the preview. The two are reconciled inside `reviewFinding`
     * through the shared occurrence identity rather than here, so the gate and
     * the pending projection cannot drift apart. Judging the observer's finding
     * id against the preview's changes could never match: the two runs issue
     * separate uuids, so every review reported "the planner proposes no
     * correction" for a finding that had one.
     */
    const decision = reviewFinding(finding, previewPlanRef.current, previewFindingsRef.current);
    if (decision.kind === "pending") {
      try {
        saveReviewDecision({
          identity: reviewIdentity(finding),
          ruleId: finding.ruleId ?? finding.category,
          category: finding.category,
          decision: "approved",
          expected: finding.expected ?? null,
          decidedAt: new Date().toISOString(),
        });
        setExpiredDecisionCount(0);
      } catch (error: unknown) {
        setReviewNote(
          `That decision could not be recorded: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
    }
    /*
     * Both outcomes speak through the one pane-wide live region rather than
     * adding a second `role="status"` beside the list. A review that produced no
     * pending change has to say so â€” otherwise the button looks broken again,
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
  /**
   * Skip: leave this occurrence out of the current review, keep it in the list.
   *
   * Spec §15. Deliberately *not* Ignore: Ignore removes the finding from the list
   * and needs a Restore, which is a different decision. A skip records the
   * occurrence in the review session so the card reads "Skipped" and the
   * reviewed-only projection excludes it, and the finding stays visible and
   * described above it.
   *
   * No plan is consulted. Skipping is declining, and declining needs no
   * correction to decline — so it works before a preview exists, which is
   * exactly the case where a user who does not want one change queued needs it.
   */
  function skipOne(finding: Finding): void {
    const identity = reviewIdentity(finding);
    try {
      saveReviewDecision({
        identity,
        ruleId: finding.ruleId ?? finding.category,
        category: finding.category,
        decision: "skipped",
        expected: finding.expected ?? null,
        decidedAt: new Date().toISOString(),
      });
      setExpiredDecisionCount(0);
      setReviewNote("Skipped. This occurrence stays in the document unchanged.");
      announcement.announce("Occurrence skipped.");
    } catch (error: unknown) {
      setReviewNote(
        `That decision could not be recorded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Undo decision: withdraw whatever was decided about this occurrence.
   *
   * Clears both records, because they are the same decision stored twice — the
   * legacy review entry the projection narrows by, and the session entry the
   * card reads. Clearing one and leaving the other would produce a card reading
   * "Undecided" over a change that is still queued.
   */
  function undoOne(finding: Finding): void {
    const identity = reviewIdentity(finding);
    try {
      clearReviewDecision(identity);
      setExpiredDecisionCount(0);
    } catch {
      /*
       * No session in force is the normal case here, not a failure.
       *
       * A review can exist without a session — the store carries both, and a
       * session is only established by a full review run. Withdrawing the review
       * is the part that matters for the plan, so a missing session is a no-op
       * rather than a message on screen for a button that did the right thing.
       */
    }
    setReviewNote("Decision undone. This occurrence can be reviewed again.");
    announcement.announce("Decision undone.");
  }

  /**
   * Approve every occurrence in a group, or none of them (spec §13, §15).
   *
   * **The all-or-nothing rule is not reimplemented here.** `approveGroup` decides
   * it, and it is handed the *preview* plan and the preview run's own findings —
   * the same pairing `reviewOne` uses, because a change names its finding by a
   * uuid from the run that planned it. Handing it the observer's findings would
   * match nothing and refuse every group for the wrong reason.
   *
   * The group's occurrences are the observer's, because that is the run whose
   * findings the user is looking at. That is why the observer carries its groups:
   * a group joined across runs would have every occurrence "missing", and
   * `undecidedOccurrences` refuses exactly that.
   *
   * A refusal records nothing. That is the module's whole design and the reason it
   * exists rather than a loop over `reviewFinding`: a group where some can be
   * approved and some cannot is refused whole, so the button has one predictable
   * outcome rather than a partial success depending on data the user cannot see.
   */
  function approveGroupAll(group: DeterministicFindingGroup): void {
    const outcome = approveGroup({
      group,
      findings,
      plan: previewPlanRef.current,
      planFindings: previewFindingsRef.current,
      alreadyDecided: new Set([...reviewedKeys, ...skippedKeys]),
      decidedAt: new Date().toISOString(),
    });
    if (outcome.kind === "refused") {
      setReviewNote(outcome.message);
      announcement.announce(outcome.message);
      return;
    }
    /*
     * Persisted after the verdict, not before.
     *
     * The module returns the decisions to record; it deliberately does not write.
     * Recording first would leave approvals in the store for a group the change
     * checks then refused — Pending Changes would show occurrences the user never
     * successfully approved.
     */
    try {
      outcome.decisions.forEach((entry) => saveReviewDecision(entry));
      setExpiredDecisionCount(0);
    } catch (error: unknown) {
      setReviewNote(
        `That decision could not be recorded: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    setReviewNote(outcome.message);
    announcement.announce(outcome.message);
    setPendingOpen(true);
  }

  /**
   * Decline every occurrence in a group, for the same all-or-nothing reason.
   *
   * Needs no plan: declining is not consenting, and twenty banned terms left in
   * the document carry no risk. A group the engine refused to *approve* as a batch
   * can still be declined as one, which is why this does not consult
   * `safeBatchApproval`.
   */
  function skipGroupAll(group: DeterministicFindingGroup): void {
    const outcome = skipGroup({
      group,
      findings,
      plan: previewPlanRef.current,
      planFindings: previewFindingsRef.current,
      alreadyDecided: new Set([...reviewedKeys, ...skippedKeys]),
      decidedAt: new Date().toISOString(),
    });
    if (outcome.kind === "refused") {
      setReviewNote(outcome.message);
      announcement.announce(outcome.message);
      return;
    }
    try {
      outcome.decisions.forEach((entry) => saveReviewDecision(entry));
      setExpiredDecisionCount(0);
    } catch (error: unknown) {
      setReviewNote(
        `That decision could not be recorded: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    setReviewNote(outcome.message);
    announcement.announce(outcome.message);
  }

  function rescanNow(): void {
    previewedDocHashRef.current = null;
    setReformatResult(null);
    setPendingOpen(false);
    setReviewNote(null);
    observerRef.current?.onDocumentChanged();
    announcement.announce("Re-scanning the document.");
  }

  /**
   * Build the preview on demand, for the case auto-preview declined.
   *
   * The auto-preview effect already handles the ordinary case, so this exists for
   * a narrowed scan: a partial read cannot produce a whole-document plan, and the
   * effect asks the observer for a full scan instead. Pressing Preview requests
   * the same thing explicitly rather than presenting a control that duplicates a
   * button the user cannot see.
   */
  function buildPreviewNow(): void {
    previewedDocHashRef.current = null;
    observerRef.current?.onDocumentChanged();
    announcement.announce("Rebuilding the preview for this document.");
  }

  /**
   * Take one change out of Pending Changes.
   *
   * This withdraws the review that admitted the change, so the reviewed-only
   * projection drops it on the next render. It does not touch the document and
   * does not reject the remaining changes — that is what "Reject all" is for.
   *
   * Resolved through the change's finding rather than through the change id,
   * because the store is keyed on the occurrence identity the review gate uses,
   * and a change id from the preview run is not an identity that store holds.
   */
  function removeOneFromPending(changeId: string): void {
    const change = reviewedOnly?.plan.changes.find((entry) => entry.id === changeId);
    if (change === undefined || change.findingId === undefined) {
      setReviewNote("That change is no longer part of this review.");
      return;
    }
    const owner = previewFindings.find((entry) => entry.id === change.findingId);
    if (owner === undefined) {
      setReviewNote("That change is no longer part of this review.");
      return;
    }
    /*
     * The store write is guarded, and the success note follows it.
     *
     * `clearReviewDecision` throws when there is no review session to clear —
     * the session expires, or a profile change invalidated it — and can fail on
     * the write itself. Unguarded, that escaped the click handler and the note
     * was never set, so the card stayed in Pending Changes with nothing on
     * screen to explain it: the click appeared to do nothing at all. Stating
     * success before the store confirmed it was the worse half of the same
     * bug — a change that was still queued, described as removed.
     */
    try {
      clearReviewDecision(reviewIdentity(owner));
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      setReviewNote(
        `That change could not be removed from Pending changes: ${detail}. Nothing was applied to the document.`,
      );
      return;
    }
    setReviewNote("Removed from Pending changes. Nothing was applied to the document.");
  }

  /*
   * Drop the expired reviews once the scan has settled.
   *
   * Counting them is not enough. A review that no longer describes anything in
   * the document would sit in the store indefinitely, and a document that later
   * re-derives the same finding at the same offset would find a stale approval
   * already waiting for it — which is precisely the thing a review must never be.
   *
   * Above the early return, with the live identity set built inside it. A hook
   * after a conditional return runs on some renders and not others, so React's
   * hook order differs between them; and depending on a Set rebuilt every render
   * made the effect fire on every render rather than once per settled scan. The
   * dependency is the observer's own `documentVersion`, which only changes when a
   * scan has read the document — so a review persisted from a previous session
   * cannot be pruned before the first scan of this one has looked.
   */
  if (
    page === "settings" ||
    page === "profile" ||
    page === "governance-policy" ||
    page === "consistency" ||
    page === "semantic-review" ||
    page === "semantic-style" ||
    page === "troubleshooting"
  ) {
    const back = () => navigate("review");
    return (
      <main className="tf-card" tabIndex={0}>
        <TaskPaneHeader
          activePage={page}
          profileName={activeProfile.name}
          profileRevision={activeProfile.revision}
          onNavigate={navigate}
        />
        <Suspense fallback={<div role="status">Loadingâ€¦</div>}>
          {page === "settings" ? (
            <Settings onBack={back} />
          ) : page === "profile" ? (
            <Profile onBack={back} capabilities={caps} />
          ) : page === "governance-policy" ? (
            <GovernancePolicy onBack={back} />
          ) : page === "consistency" ? (
            <ConsistencyReview
              onBack={back}
              onOpenSettings={() => navigate("settings")}
              result={consistencyResult}
              onResult={setConsistencyResult}
            />
          ) : page === "semantic-style" ? (
            <SemanticStyle
              onBack={() => navigate("semantic-review")}
              onOpenSettings={() => navigate("settings")}
            />
          ) : page === "semantic-review" ? (
            <SemanticReview
              onBack={back}
              onOpenSettings={() => navigate("settings")}
              onOpenSemanticStyle={() => navigate("semantic-style")}
              onReviewStatus={setSemanticReviewStatus}
              /*
               * The session is owned here, above the page, so navigating away and
               * back does not discard a review the user has paid for. The page
               * owns the actions; this owns what survives a navigation — the same
               * split `consistencyResult` already uses.
               */
              session={semanticSession}
              onSession={setSemanticSession}
              navigation={arrival}
            />
          ) : (
            /*
             * The plan and review counts go in so the registry can report an
             * Apply blocked by an unreviewed plan. That refusal is invisible from
             * the button itself: it is simply disabled, and nothing near it says
             * why. `reformatResult` and `reviewedKeys` are the state this page
             * already holds, read here rather than re-derived, so the panel
             * cannot disagree with the pending-changes section below it.
             */
            <DebuggingPanel
              onBack={back}
              coverage={status?.coverage ?? null}
              plannedCount={reformatResult?.plan.changes.length ?? 0}
              reviewedCount={reviewedKeys.size}
              // The report's own account of what it compared, passed through
              // rather than recomputed. The engine distinguishes "no model was
              // consulted" from "some pairs were skipped" and the remedy
              // differs between them, so collapsing both to "did not run" would
              // send the user to the wrong setting half the time.
              consistency={
                consistencyResult === null
                  ? null
                  : {
                      usedModel: consistencyResult.usedModel,
                      complete: consistencyResult.coverage.complete,
                      limitations: consistencyResult.coverage.limitations,
                      unresolved: consistencyResult.coverage.unresolved,
                      decisionParseFailed: consistencyResult.coverage.decisionParseFailed,
                    }
              }
              // `null` for "not established" and `false` for "read and found
              // nothing" are the same answer here only because both mean no
              // selection is held. The panel's third state is the page having
              // never reported at all, which this cannot be: the effect above
              // clears the state on the way out, so a null here always means the
              // pages are not open. `null` survives as `null`: `undefined !== null`
              // is true, which would report a page that was never opened as a
              // selection that was captured.
              semanticSelectionCaptured={
                semanticReviewStatus === null ? null : semanticReviewStatus.heldChars !== null
              }
              semanticSelectionChars={semanticReviewStatus?.heldChars ?? null}
              semanticPreservationRefused={semanticReviewStatus?.preservationRefused ?? false}
            />
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
   * a rule rather than of an occurrence â€” so ignoring one em dash hid every
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
   * empty one â€” while the toolbar, reading the observer, still said three.
   *
   * The list and the count must come from the same source or the pane
   * contradicts itself, and the observer is the one that scanned the document
   * the user is looking at.
   */
  const findings = observerFindings;
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
   * findings â€” and only that.
   *
   * Both the table and `applyPendingPlan` read this same value, so there is no
   * path by which the pane displays one set of changes and writes another. It
   * is also the plan the review gate judges against, for the same reason: a
   * verdict of "added to Pending changes" has to describe what Apply will do.
   *
   * The findings passed are the *preview run's own*. A change's `findingId`
   * names a finding from the run that planned it, so pairing the plan with the
   * observer's list would match nothing and leave Apply permanently empty â€”
   * safe, but indistinguishable from a broken button.
   */
  const previewFindings = reformatResult?.report.findings ?? [];
  const reviewedOnly = resolvePendingPlan(reformatResult);
  /*
   * A discriminated result, so "no plan yet", "nothing reviewed", and "a
   * reviewed subset" are three answers rather than two.
   *
   * The previous shape returned `ChangePlan | null` and the caller resolved the
   * ambiguity with `reviewedPlan(...) ?? fullPlan` â€” so a user who had reviewed
   * nothing was handed the entire plan as "pending". Apply's own gate would
   * refuse it, but the table listed every change and the count claimed they were
   * all the user's to apply, which is the exact thing the reviewed-only list
   * exists to prevent. `reviewedPlan` now refuses to be resolved that way.
   */
  /*
   * The approved set, with skips removed.
   *
   * `reviewedPlan` narrows the plan to these identities, so a skipped occurrence
   * must not be in the set it is given. Filtering here rather than inside
   * `reviewedPlan` keeps the projection honest about what it was asked for, and
   * `approvedIdentities` is the one place the two sets are reconciled.
   */
  const approvedKeys = approvedIdentities(reviewedKeys, skippedKeys);
  const projection =
    reviewedOnly === null
      ? ({
          kind: "no-plan",
          plan: null,
          reason: "No preview has been built for this document yet.",
        } as const)
      : reviewedPlan(reviewedOnly.plan, approvedKeys, previewFindings);
  pendingPlanRef.current =
    projection.kind === "reviewed" ? { ...reviewedOnly!, plan: projection.plan } : null;
  previewPlanRef.current = reviewedOnly?.plan ?? null;
  previewFindingsRef.current = previewFindings;
  const pendingPlan = pendingPlanRef.current;
  /** Why the section is empty, in the words the three states each deserve. */
  const pendingEmptyReason = projection.plan === null ? projection.reason : null;
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
   * A review that no longer describes anything in this document.
   *
   * A review is tied to exact text, so an edit anywhere above a reviewed finding
   * moves it and the decision expires. The old behaviour was to let the pending
   * list empty silently, which reads as the tool losing the user's work. Saying
   * how many expired is the difference between a decision being respected and a
   * decision being quietly forgotten.
   */
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
          actually on. Hardcoding "home" here left "Deterministic Review"
          highlighted while the AI Review page was open. */}
      <TaskPaneHeader
        activePage={page}
        profileName={activeProfile.name}
        profileRevision={activeProfile.revision}
        onNavigate={navigate}
        // Only where an observer is actually running. On the pages that have
        // none, a "Last scan" reading the profile's own revision would be a
        // claim about a scan that never happened.
        lastScan={status === null ? undefined : (status.lastScan ?? null)}
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

      {page === "review" && findingsOpen && (
        <section className="tf-collapsible" aria-label="Findings section">
          <button
            type="button"
            className="tf-native-button tf-collapsible-header"
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
              {/*
                Spec §22: severity and category, because they answer different
                questions. "How bad" tells a reader whether to stop reading;
                "what kind" tells them where to start, and a document with four
                hundred spacing findings and twenty structural ones cannot be
                triaged from the first number alone.

                Counted over the same filtered list the count above uses, so the
                two lines cannot disagree about what is open.
              */}
              <p className="tf-sub">
                {describeOpenFindings(openSummary)}
                {describeCategoryGroups(openSummary.byGroup) !== "" &&
                  ` / ${describeCategoryGroups(openSummary.byGroup)}`}
              </p>
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
                /*
                 * This run's own groups, not the preview report's.
                 *
                 * The list is the observer's findings (see above), and the two runs
                 * issue separate uuids, so the preview's `occurrenceIds` name
                 * occurrences that are not in this list. The observer carries the
                 * groups from the same `runDeterministicReview` call that produced
                 * these findings, so they address it exactly.
                 */
                groups={status?.groups ?? []}
                onApproveAll={approveGroupAll}
                onSkipAll={skipGroupAll}
                selectedIndex={workflow.planReview.selectedFindingIndex}
                reviewedKeys={reviewedKeys}
                skippedKeys={skippedKeys}
                onReview={reviewOne}
                onSkip={skipOne}
                onUndo={undoOne}
                approveRefusal={unapprovableReason}
                onIgnore={(findingId) => {
                  const finding = findings.find((item) => item.id === findingId);
                  if (finding) ignoreFinding(finding);
                }}
              />
              {/*
               * The gate's verdict, in a live region.

               * A review that produced no pending change has to say so. The
               * alternative is a button that appears to do nothing again â€” which
               * is exactly what the status label-only version of Review did.
               */}
              {reviewNote !== null && <p className="tf-sub">{reviewNote}</p>}
              {/*
                Reviews that no longer describe anything in this document.

                A review is tied to exact text, so an edit above a reviewed
                finding moves it and the decision expires. Letting the pending
                list empty quietly reads as the tool losing the user's work, so
                the count is stated. Nothing is applied on the strength of an
                expired review; the user reviews again, which is the direction
                that fails safe.
              */}
              {expiredDecisionCount > 0 && (
                <p className="tf-sub">
                  {expiredDecisionCount} review decision{expiredDecisionCount === 1 ? "" : "s"}{" "}
                  expired because the document or review policy changed. Review the findings again
                  before adding changes to Pending changes.
                </p>
              )}
            </>
          )}
        </section>
      )}
      {page === "review" && !findingsOpen && (
        <button
          type="button"
          className="tf-native-button tf-collapsible-header"
          onClick={() => setFindingsOpen(true)}
          aria-expanded={false}
        >
          Findings <span>{findings.length}</span>
        </button>
      )}
      {/*
       * The rest of the review page, in the order the work is done: findings,
       * coverage, set aside, then the change list.
       *
       * This is a reorder, not a redesign. The same four things render in the
       * same components. It previously read Findings then Pending changes then
       * Coverage then Set aside, which put the qualification of the findings
       * after the list itself, dropped a partial-review warning underneath the
       * Apply button it was warning about, and left the set-aside entries last
       * even though their purpose is to explain an absence from the list above.
       * Stale, host readiness and the rescan control are conditions of the page
       * rather than sections within it, so they stay at the top of the block.
       */}
      {page === "review" && (
        <>
          <StaleBanner
            stale={status?.stale ?? false}
            hostUnavailable={status?.hostUnavailable ?? false}
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
                <button
                  className="tf-native-button"
                  type="button"
                  onClick={() => setPage("settings")}
                >
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
            collapsed header, so collapsing never hides *whether* it passed â€”
            only the detail behind it.
          */}
          <CoverageBanner
            coverage={status?.coverage ?? null}
            deterministicCoverage={status?.deterministicCoverage ?? null}
            /*
             * The open count, so the verdict can be a compliance claim rather
             * than only a coverage claim. `openSummary.total` is the same number
             * the findings header prints — filtered for ignores, recomputed from
             * the visible list — so the banner and the list cannot disagree about
             * what is left to do.
             */
            openFindings={openSummary.total}
            open={coverageIncomplete || coverageOpen}
            onToggle={() => setCoverageOpen((open) => !open)}
            onRescan={() => {
              setCoverageOpen(true);
              rescanNow();
            }}
          />
          {/*
            Repeated outside the collapsible so a collapsed banner never hides
            the reason Apply is unavailable. A blocker that lives only behind a
            disclosure triangle is a blocker the user will not find.
          */}
          {remainingScopes.length > 0 && (
            <p className="tf-coverage-blocked" role="status">
              Not checked: {remainingScopes.map(scopeLabel).join(", ")}. Apply stays unavailable
              until the scope is read, or until you stop requiring it in the governance policy.
            </p>
          )}
          {/*
            The post-apply result block, immediately under the coverage verdict
            and above the findings.

            Placed here rather than beside Pending Changes because by the time it
            exists Pending Changes is empty on success — the plan was consumed —
            and the reader is already looking at the findings list to decide what
            to do about the revisions Word just marked up.
          */}
          <ApplyResultBlock
            outcome={applyOutcome}
            open={applyResultOpen}
            onToggle={() => setApplyResultOpen((open) => !open)}
            onReviewRemaining={() => {
              setPage("review");
              setFindingsOpen(true);
            }}
          />
          {/*
            The one thing auto-preview owes the user when it declines: the
            reason, and what would produce a preview instead. Silence here
            would read as "the pane is working" while nothing was planned.
          */}
          {previewNote !== null && <p className="tf-sub">{previewNote}</p>}
        </>
      )}
      {page === "review" && (
        <IgnoredFindings
          entries={persisted.ignoredFindings ?? []}
          onRestore={(occurrence) => restoreFinding(occurrence)}
        />
      )}
      {/*
       * Apply All and Re-scan Now, on one row below the findings navigation.
       *
       * Both are decisions about the whole document rather than about the
       * selected finding, so they sit outside the per-card actions: a user
       * stepping through findings should not be offered a button that rewrites
       * all of them. Re-scan Now is always available â€” it is the only way back
       * to a fresh list when auto-scan is off.
       */}
      {page === "review" && (
        <div className="tf-actions">
          {/*
            Only Re-scan now. The row used to carry an "Apply all changes" button
            that applied the whole plan, which is the exact behaviour the
            reviewed-only list exists to prevent â€” and it sat beside a Pending
            Changes section that Apply already owned, so the two disagreed about
            what "all" meant. One Apply, in the section that lists what it will
            do, is the only version a user can read before pressing it.
          */}
          <button
            className="tf-native-button"
            type="button"
            onClick={rescanNow}
            disabled={status?.phase === "scanning"}
          >
            {status?.phase === "scanning" ? "Re-scanningâ€¦" : "Re-scan now"}
          </button>
        </div>
      )}
      {page === "review" && !pendingOpen ? (
        <button
          type="button"
          className="tf-native-button tf-collapsible-header"
          onClick={() => setPendingOpen(true)}
          aria-expanded={false}
        >
          Pending changes <span>{totalPlannedChanges}</span>
        </button>
      ) : (
        <section className="tf-collapsible" aria-label="Pending changes section">
          <button
            type="button"
            className="tf-native-button tf-collapsible-header"
            onClick={() => setPendingOpen(false)}
            aria-expanded
          >
            Pending changes <span>{totalPlannedChanges}</span>
          </button>
          <PendingChanges
            plan={pendingPlan?.plan ?? null}
            emptyReason={pendingEmptyReason}
            totalCount={totalPlannedChanges}
            reviewedCount={reviewedChangeCount}
            /*
             * Preview, offered only where the pane can build one. The effect above
             * already previews automatically on a settled scan, so this control
             * exists for the case that effect declines — a narrowed scan, which
             * needs a full rescan before a plan can be built at all.
             */
            {...(pendingPlan === null ? { onPreview: buildPreviewNow } : {})}
            /*
             * Remove takes one change out of Pending Changes by withdrawing the
             * review that put it there. It does not reject the rest, which is what
             * "Reject all" is for.
             */
            onRemove={(changeId) => removeOneFromPending(changeId)}
            /*
             * The preview's findings, not the observer's, and deliberately so.
             * Each change carries a `findingId` from the run that planned it, so
             * the annotation is only found in that same run's findings. Passing
             * the observer's would look up ids that were never issued and print
             * every change as unexplained.
             */
            findings={reformatResult?.report.findings ?? findings}
            coverage={pendingPlan?.coverage ?? null}
            exportCoverage={reformatResult?.sharedCoverage ?? null}
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
    </main>
  );
}
