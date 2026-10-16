import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { toAnalysisCapabilities, type WordCapabilities } from "../../word/capabilityProbe";
import type { AnalysisCapabilities } from "../../analysis/analysisContext";
import {
  createGovernanceProfile,
  type GovernanceProfile,
} from "../../core/domain/GovernanceProfile";
import { createDocumentObserver, type DocumentObserverStatus } from "../../word/documentObserver";
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
import type { SemanticFailureCode } from "../../analysis/semantic/failures";
import DebuggingPanel from "../components/DebuggingPanel";
import TaskPaneHeader, { type TaskPaneDestination } from "../components/TaskPaneHeader";
import {
  AppShell,
  Breadcrumb,
  PaneHeader,
  reviewHeaderMarkers,
  styleHeaderMarkers,
  semanticReviewHeaderMarkers,
  consistencyHeaderMarkers,
  governanceHeaderMarkers,
  scanPhaseStatus,
  type PaneHeaderProps,
  type PaneMarker,
} from "../shell";
import { LoadingState } from "../components/common/LoadingState";
import { DisclosurePanel } from "../components/common";
import ReviewWithoutProfile from "./ReviewWithoutProfile";
import CoverageBanner, { scopeLabel } from "../components/CoverageBanner";
import StaleBanner from "../components/StaleBanner";
import IgnoredFindings from "../components/IgnoredFindings";
import FindingTypeList from "../components/FindingTypeList";
import FindingDetailOverlay from "../components/FindingDetailOverlay";
import { projectFindingsByType, type FindingTypeGroup } from "../findingsByType";
import type { ConsistencyReport } from "../../analysis/consistency";
import type { buildCoverage } from "../../analysis/coverage";
import { findingFingerprint } from "../findingFingerprint";
import { isAnyIgnored, withoutIgnored } from "../isIgnoredFinding";
import { goToFinding } from "../findingNavigation";
import { decidePreview, isFullScan } from "../autoPreview";
import { reformatDocument } from "../../reformat";
import { changeForFinding, narrowPlanToChanges, reviewedPlan } from "../reviewGate";
import { approvedIdentities } from "../approvalControls";
import {
  ensureReviewSession,
  loadReviewSession,
  saveReviewDecision,
} from "../../core/state/reviewSession";
import { reviewIdentity, occurrenceKey } from "../occurrenceIdentity";
import { setupStatusFromState, type SetupStatus } from "../setupStatus";
import {
  describeCategoryGroups,
  describeOpenFindings,
  summarizeOpenFindings,
  type OpenFindingsSummary,
} from "../findingsSummary";
import {
  ignoreFinding as persistIgnore,
  loadState,
  restoreFinding,
} from "../../core/state/persistence";
import { selectActiveProfile } from "../../core/state/profileSelectors";
import { usePersistedState } from "../state/usePersistedState";
import { useAnnouncement } from "../settings/useAnnouncement";
import { usePageNavigation } from "../usePageNavigation";
import { parentRoute, routeLabel } from "../routes";
import { deriveAnnouncement } from "../state/announcement";
import { hostReadinessMessage } from "../settings/applyReadiness";
import type { StyleProfile, StyleProfileSchema } from "../../core/domain/StyleProfile";
import type { Finding } from "../../core/domain/Finding";
import type { Change } from "../../core/domain/Change";
import type { ChangePlan } from "../../core/domain/ChangePlan";
import type { PersistedState } from "../../core/state/persistence";
import type { SemanticReviewSession } from "../../core/domain/SemanticReviewSession";

const LlmSettings = lazy(() => import("./LlmSettings"));
const GeneralSettings = lazy(() => import("./GeneralSettings"));
const Profile = lazy(() => import("./Profile"));
const GovernancePolicy = lazy(() => import("./GovernancePolicy"));
const ConsistencyReview = lazy(() => import("./ConsistencyReview"));
const SemanticReview = lazy(() => import("./SemanticReview"));
const SemanticStyle = lazy(() => import("./SemanticStyle"));
const Home = lazy(() => import("./Home"));
import type { HomeState } from "./homeState";

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
/** The governance markers for the active stored policy, or the house default. */
function governanceMarkersFromState(state: PersistedState): PaneMarker[] {
  const id = state.activeGovernanceProfileId;
  const stored = id === null ? undefined : state.governanceProfiles[id];
  return governanceHeaderMarkers({
    profileName: stored === undefined ? null : "Authored policy",
    policyRevision: stored === undefined ? null : stored.version,
    protectedRangeCount: stored?.protection.userLockedRanges.length ?? 0,
  });
}

/** Everything the pane header reads, gathered from state the Dashboard holds. */
interface PaneHeaderData {
  page: TaskPaneDestination;
  setup: SetupStatus;
  profile: { name: string; revision: number } | null;
  semanticProfile: { name: string; revision: number } | null;
  observerStatus: DocumentObserverStatus | null;
  openSummary: OpenFindingsSummary | null;
  governanceMarkers: readonly PaneMarker[];
  trackedEditingEnabled: boolean;
  selectionChars: number | null;
  consistencyRan: boolean;
  consistencyComplete: boolean;
}

/**
 * Build the pane header for a destination (ADR-0138).
 *
 * One builder, called with state the Dashboard already holds, so the header and
 * the page body cannot disagree: both read the same `observerStatus`,
 * `openSummary`, and profile. The title is `routeLabel(page)`, the same source
 * the drawer and the ribbon read, so the heading cannot drift from them.
 *
 * The switch is exhaustive over `TaskPaneDestination` on purpose: a new
 * destination must pick a header level here, which is how the routing invariant
 * (ADR-0102) stays true for the header too.
 */
function buildPaneHeader(data: PaneHeaderData): React.ReactNode {
  const { page } = data;
  const title = routeLabel(page);
  const providerConfigured =
    data.setup.items.find((item) => item.id === "llmProvider")?.ready ?? false;

  switch (page) {
    case "landing": {
      const markers: PaneMarker[] = [
        {
          key: "deterministic",
          label: "Deterministic style",
          value:
            data.profile === null ? "None yet" : `${data.profile.name} · r${data.profile.revision}`,
          tone: "neutral",
          title: data.profile === null ? "No deterministic style profile exists yet." : undefined,
        },
        {
          key: "semantic",
          label: "Semantic style",
          value:
            data.semanticProfile === null
              ? "None yet"
              : `${data.semanticProfile.name} · r${data.semanticProfile.revision}`,
          tone: "neutral",
          title:
            data.semanticProfile === null ? "No semantic style profile exists yet." : undefined,
        },
      ];
      return (
        <PaneHeader
          title={title}
          status={{
            label: data.setup.complete ? "Ready" : "Incomplete",
            title: data.setup.complete
              ? "Setup is complete: a deterministic style profile, a semantic style profile, and an AI provider are all in place."
              : "Setup is incomplete: at least one of the deterministic style profile, the semantic style profile, or the AI provider is still missing.",
          }}
          markers={markers}
        />
      );
    }
    case "review": {
      const observer = data.observerStatus;
      return (
        <PaneHeader
          title={title}
          status={{
            label: observer === null ? "Not checked" : scanPhaseStatus(observer.phase),
            title:
              observer === null
                ? "The document has not been scanned yet."
                : `The last scan is ${scanPhaseStatus(observer.phase).toLowerCase()}.`,
          }}
          markers={reviewHeaderMarkers({
            profileName: data.profile?.name ?? null,
            profileRevision: data.profile?.revision ?? null,
            lastScan: observer?.lastScan ?? null,
            examinedScopes: observer?.deterministicCoverage?.examinedScopes ?? [],
            phase: observer?.phase ?? "notStarted",
            stale: observer?.stale ?? false,
            hostUnavailable: observer?.hostUnavailable ?? false,
            findingCount: data.openSummary?.total ?? 0,
            errorCount: data.openSummary?.mandatory ?? 0,
            warningCount: data.openSummary?.advisory ?? 0,
            coverageComplete: observer?.deterministicCoverage?.complete ?? false,
          })}
        />
      );
    }
    case "semantic-review":
      return (
        <PaneHeader
          title={title}
          markers={semanticReviewHeaderMarkers({
            styleName: data.semanticProfile?.name ?? null,
            styleRevision: data.semanticProfile?.revision ?? null,
            selectionChars: data.selectionChars,
            providerConfigured,
          })}
        />
      );
    case "consistency":
      return (
        <PaneHeader
          title={title}
          markers={consistencyHeaderMarkers({
            ran: data.consistencyRan,
            complete: data.consistencyComplete,
            providerConfigured,
          })}
        />
      );
    case "profile":
      return (
        <PaneHeader
          title={title}
          markers={styleHeaderMarkers({
            profileName: data.profile?.name ?? null,
            profileRevision: data.profile?.revision ?? null,
            hasDraft: false,
          })}
        />
      );
    case "semantic-style":
      return (
        <PaneHeader
          title={title}
          markers={styleHeaderMarkers({
            profileName: data.semanticProfile?.name ?? null,
            profileRevision: data.semanticProfile?.revision ?? null,
            hasDraft: false,
          })}
        />
      );
    case "governance-policy":
      return <PaneHeader title={title} markers={data.governanceMarkers} />;
    case "llm-settings": {
      const blocked = data.setup.items.find((item) => item.id === "llmProvider")?.blocked ?? null;
      return (
        <PaneHeader
          title={title}
          status={{
            label: providerConfigured ? "Ready" : "Unavailable",
            title: providerConfigured
              ? "An AI provider is connected."
              : "No AI provider is connected. Semantic Review and the consistency check are unavailable.",
          }}
          warning={
            blocked === null
              ? null
              : { tone: "warning", title: "No provider connected", body: blocked }
          }
        />
      );
    }
    case "general-settings": {
      const blockedProfile =
        data.setup.items.find((item) => item.id === "deterministicProfile")?.blocked ?? null;
      const warning: PaneHeaderProps["warning"] = !data.trackedEditingEnabled
        ? {
            tone: "warning",
            title: "Tracked editing is off",
            body: hostReadinessMessage({
              trackedEditingEnabled: false,
              capabilities: null,
            }).message,
          }
        : blockedProfile === null
          ? null
          : { tone: "warning", title: "No deterministic style profile", body: blockedProfile };
      return (
        <PaneHeader
          title={title}
          status={{
            label: data.setup.complete ? "Ready" : "Incomplete",
            title: data.setup.complete
              ? "Setup is complete: a deterministic style profile, a semantic style profile, and an AI provider are all in place."
              : "Setup is incomplete: at least one of the deterministic style profile, the semantic style profile, or the AI provider is still missing.",
          }}
          warning={warning}
        />
      );
    }
    case "troubleshooting": {
      const openItems = data.setup.items.filter((item) => !item.ready);
      return (
        <PaneHeader
          title={title}
          status={{
            label: data.setup.complete ? "Complete" : "Incomplete",
            title: data.setup.complete
              ? "Every setup item is ready."
              : `${openItems.length} setup item${openItems.length === 1 ? "" : "s"} still to set up: ${openItems
                  .map((item) => item.label)
                  .join(", ")}.`,
          }}
          warning={
            openItems.length === 0
              ? null
              : {
                  tone: "warning",
                  title: "Setup is incomplete",
                  body: `${openItems.length} item${openItems.length === 1 ? "" : "s"} still to set up: ${openItems
                    .map((item) => item.label)
                    .join(", ")}.`,
                }
          }
        />
      );
    }
  }
}

export interface DashboardProps {
  /** The page this pane opens on. Defaults to the landing page. */
  initialPage?: DashboardInitialPage;
}

export default function Dashboard({ initialPage = "landing" }: DashboardProps): React.ReactNode {
  // Derived from the store, not snapshotted once at mount: a publish/activate
  // must swap the review to the new revision without a task-pane reload.
  const persisted = usePersistedState();
  const activeProfile = selectActiveProfile(persisted);

  if (!activeProfile) {
    return <DashboardWithoutProfile activeProfile={activeProfile} initialPage={initialPage} />;
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
 * `activeProfile` is passed through rather than resolved again; the parent derives
 * it from the store and swaps this component for the full dashboard the moment a
 * profile is created.
 */
function DashboardWithoutProfile({
  activeProfile,
  initialPage,
}: {
  activeProfile: StyleProfile | null;
  initialPage: DashboardInitialPage;
}): React.ReactNode {
  const { page, navigate, parent, goToParent } = usePageNavigation(initialPage);
  const persisted = usePersistedState();
  const status = setupStatusFromState(persisted);
  const semanticProfileRecord = selectActiveProfile(persisted, "semantic");
  const semanticProfileSummary =
    semanticProfileRecord === null
      ? null
      : { name: semanticProfileRecord.name, revision: semanticProfileRecord.revision };

  const header = (
    <TaskPaneHeader
      activePage={page}
      onNavigate={navigate}
      paneHeader={buildPaneHeader({
        page,
        setup: status,
        profile:
          activeProfile === null
            ? null
            : { name: activeProfile.name, revision: activeProfile.revision },
        semanticProfile: semanticProfileSummary,
        observerStatus: null,
        openSummary: null,
        governanceMarkers: governanceMarkersFromState(persisted),
        trackedEditingEnabled: isTrackedEditingEnabled(),
        selectionChars: null,
        consistencyRan: false,
        consistencyComplete: false,
      })}
    />
  );

  /*
   * Breadcrumbs resolve their destination from the parent map (ADR-0137), so a
   * breadcrumb's label is always the page it lands on. The mapped parent is fixed
   * by `PARENT_ROUTE`; the two settings pages return to the page the user was on
   * when they opened them, which is what `resolveParentDestination` resolves.
   */

  /**
   * Leaving the profile editor with no profile returns to the checklist.
   *
   * Navigating here is what makes "Back" mean back: it restores this
   * component's own `page` state, which would otherwise leave the user on the
   * editor with the header as the only way out.
   */
  function leaveProfileEditor(): void {
    navigate("landing");
  }

  if (page === "llm-settings") {
    return (
      <AppShell header={header}>
        <Suspense fallback={<LoadingState label="Loading…" />}>
          <LlmSettings onBack={goToParent} parent={parent} />
        </Suspense>
      </AppShell>
    );
  }

  if (page === "general-settings") {
    return (
      <AppShell header={header}>
        <Suspense fallback={<LoadingState label="Loading…" />}>
          <GeneralSettings onBack={goToParent} parent={parent} />
        </Suspense>
      </AppShell>
    );
  }

  if (page === "troubleshooting") {
    return (
      <AppShell header={header}>
        <Suspense fallback={<LoadingState label="Loading…" />}>
          <DebuggingPanel onBack={goToParent} coverage={null} />
        </Suspense>
      </AppShell>
    );
  }

  if (page === "profile") {
    return (
      <AppShell header={header}>
        <Suspense fallback={<LoadingState label="Loading profile editor…" />}>
          <Profile onBack={leaveProfileEditor} />
        </Suspense>
      </AppShell>
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
      <AppShell header={header}>
        <Suspense fallback={<LoadingState label="Loading…" />}>
          <SemanticStyle
            onBack={() => navigate("semantic-review")}
            onOpenSettings={() => navigate("llm-settings")}
          />
        </Suspense>
      </AppShell>
    );
  }

  if (page === "semantic-review") {
    return (
      <AppShell header={header}>
        <Suspense fallback={<LoadingState label="Loading" />}>
          <SemanticReview
            onBack={goToParent}
            onOpenSettings={() => navigate("llm-settings")}
            onOpenSemanticStyle={() => navigate("semantic-style")}
            session={null}
            onSession={() => undefined}
          />
        </Suspense>
      </AppShell>
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
      <AppShell header={header}>
        <Suspense fallback={<LoadingState label="Loading" />}>
          <ReviewWithoutProfile onBack={goToParent} onOpenProfile={() => navigate("profile")} />
        </Suspense>
      </AppShell>
    );
  }
  if (page === "consistency") {
    return (
      <AppShell header={header}>
        <Suspense fallback={<LoadingState label="Loading…" />}>
          <ConsistencyReview
            onBack={goToParent}
            onOpenSettings={() => navigate("llm-settings")}
            result={null}
            onResult={() => undefined}
          />
        </Suspense>
      </AppShell>
    );
  }

  if (page === "governance-policy") {
    return (
      <AppShell header={header}>
        <Suspense fallback={<LoadingState label="Loading…" />}>
          <GovernancePolicy onBack={goToParent} />
        </Suspense>
      </AppShell>
    );
  }

  return (
    <AppShell header={header}>
      <Suspense fallback={<LoadingState label="Loading…" />}>
        <Home
          state={{
            setup: status,
            deterministic: null,
            semantic: null,
            consistency: null,
            activeDeterministicProfile: null,
            activeSemanticProfile: selectActiveProfile(persisted, "semantic")
              ? {
                  name: selectActiveProfile(persisted, "semantic")!.name,
                  revision: selectActiveProfile(persisted, "semantic")!.revision,
                }
              : null,
          }}
          onNavigate={navigate}
        />
      </Suspense>
    </AppShell>
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
  const activeSemanticProfileRecord = selectActiveProfile(persisted, "semantic");
  const semanticProfileSummary =
    activeSemanticProfileRecord === null
      ? null
      : { name: activeSemanticProfileRecord.name, revision: activeSemanticProfileRecord.revision };
  const { page, navigate, parent, goToParent } = usePageNavigation(initialPage);
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
  const [reformatResult, setReformatResult] = useState<ReformatResult | null>(null);
  const [status, setStatus] = useState<DocumentObserverStatus | null>(null);
  /**
   * True while the post-apply re-scan is in flight.
   *
   * An apply writes through the Word API, which moves no selection, so Word
   * fires no `documentSelectionChanged` and the observer only re-reads because
   * `overlayAccept` nudged it. Until that scan reports, the plan still holds the
   * pre-apply offsets and an Accept would be refused as stale — so the button is
   * held, with a reason, rather than reading as a silent no-op.
   */
  const [refreshingAfterApply, setRefreshingAfterApply] = useState(false);
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
  /*
   * Set when an apply has just written and the observer's refreshed findings are
   * on their way. The overlay must then re-anchor on the post-refresh group,
   * never advance an index against the pre-refresh one: the applied finding
   * leaves the refreshed list, so an advance double-counts and skips the finding
   * the user should see next.
   */
  const resumeOverlayAfterRefreshRef = useRef(false);
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
  /*
   * The one-finding overlay state.
  /*
   * The one-finding overlay state.
   *
   * `overlayGroupKey` is the rule identity of the type group being reviewed;
   * the group itself is derived from the live findings on every render so it
   * always reflects the document's current state. `overlayPosition` is the
   * 0-based index within that group.
   */
  const [overlayGroupKey, setOverlayGroupKey] = useState<string | null>(null);
  const [overlayPosition, setOverlayPosition] = useState(0);
  /** Refs mirroring overlay state, read by the re-anchor effect. */
  const overlayGroupKeyRef = useRef<string | null>(null);
  const overlayPositionRef = useRef(0);
  const updateOverlayGroupKey = (key: string | null): void => {
    overlayGroupKeyRef.current = key;
    setOverlayGroupKey(key);
  };
  const updateOverlayPosition = (pos: number): void => {
    overlayPositionRef.current = pos;
    setOverlayPosition(pos);
  };
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
    /**
     * The code the run ended on, when it failed.
     *
     * Carried here for the same reason the refusal is: the troubleshooting panel
     * is reached after the page has been navigated away from, which is exactly
     * when a failure needs explaining and the page that knows is gone.
     */
    failureCode: SemanticFailureCode | null;
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
    if (
      page === "semantic-review" ||
      page === "semantic-style" ||
      page === "troubleshooting" ||
      page === "landing"
    ) {
      return;
    }
    setSemanticReviewStatus(null);
  }, [page]);
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
      // it was derived from. Empty until the first scan has read the document,
      // so it is treated as "no scan" rather than a hash to preview against.
      docHash: status.documentVersion === "" ? null : status.documentVersion,
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
    /*
     * Wait for the capability probe before building a preview.
     *
     * Without this guard, the first scan triggers a preview under
     * FALLBACK_CAPABILITIES (all false), which makes `acquireAnalysisContext`
     * choose scope `none` — the document text is not read, and the preview
     * produces zero findings and zero changes. That empty plan is stored in
     * state and shown to the user: the overlay opens, Accept finds no change
     * to resolve, and the button reports "no correction" for a document the
     * observer has already found findings in.
     *
     * Waiting costs one extra planning pass per document and ensures the
     * single preview that runs is the only one the user ever sees.
     */
    if (caps === null) return;
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
          capabilities: toAnalysisCapabilities(caps),
        });
        previewedDocHashRef.current = decision.docHash;
        setReformatResult(result);
        // A fresh plan has landed, so the post-apply Accept guard can drop.
        setRefreshingAfterApply(false);
      } catch (error: unknown) {
        setApplyMessage(
          `Preview could not be built: ${error instanceof Error ? error.message : String(error)}`,
        );
        // A preview that never lands must not leave Accept disabled forever.
        setRefreshingAfterApply(false);
      } finally {
        previewingRef.current = false;
      }
    })();
    // `caps` is a dependency so the corrected preview runs when the probe
    // lands. It is compared by identity, and `setCaps` receives one object per
    // probe, so this re-runs once per probe rather than per render.
  }, [status, activeProfile, caps]);

  /*
   * Re-anchor the overlay once the post-apply scan has settled.
   *
   * `overlayAccept` nudges the observer after a write; when the resulting scan
   * reports, `status.findings` is the post-apply set. The Accept guard is *not*
   * released here: it is held until the matching plan lands (in the preview
   * effect), so an accept cannot be judged against the pre-apply plan and refused
   * as stale.
   */
  useEffect(() => {
    if (status !== null && status.phase !== "scanning") {
      /*
       * Clear refreshingAfterApply on terminal error/failure phases so Accept
       * is not permanently disabled when a scan fails or is skipped.
       */
      if (status.phase === "failed" || status.phase === "stale") {
        setRefreshingAfterApply(false);
      }
      /*
       * Re-anchor the overlay after an apply. `status.findings` is the refreshed
       * scan, so the applied finding has already left the group and the same index
       * names the next finding. The group is recomputed here rather than read from
       * the render's `overlayGroup`: that binding is declared below an early
       * return, so a status change landing while another page shows would touch it
       * before it is initialised. Read the latest overlay group key and position
       * from refs rather than the render's captured closure values, so the effect
       * sees the most recent navigation state. Navigate to the next finding;
       * close when the group is spent.
       */
      if (resumeOverlayAfterRefreshRef.current) {
        resumeOverlayAfterRefreshRef.current = false;
        const refreshedGroup =
          projectFindingsByType(withoutIgnored(status.findings, persisted.ignoredFindings)).find(
            (group) => group.key === overlayGroupKeyRef.current,
          ) ?? null;
        const current = refreshedGroup?.findings[overlayPositionRef.current];
        if (current) {
          void goToFinding(current);
        } else {
          closeOverlay();
        }
      }
    }
  }, [status]);

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
    return () => {
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
          navigate("troubleshooting");
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
          navigate("semantic-review");
          return;
        case "profile":
          navigate("profile");
          return;
        case "governance-policy":
          navigate("governance-policy");
          return;
        case "ai-review":
          navigate("consistency");
          return;
        case "findings":
          navigate("review");
          setFindingsOpen(true);
          break;
        case "review":
          navigate("review");
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
   * Open the overlay for a type group, starting at its first finding.
   */
  function openOverlayGroup(group: FindingTypeGroup): void {
    updateOverlayGroupKey(group.key);
    updateOverlayPosition(0);
    setReviewNote(null);
    const first = group.findings[0];
    if (first) void goToFinding(first);
  }

  /**
   * Close the overlay and reset its state.
   */
  function closeOverlay(): void {
    updateOverlayGroupKey(null);
    updateOverlayPosition(0);
    setReviewNote(null);
  }

  /**
   * Move to the previous finding in the overlay group, and take the document
   * with it.
   *
   * The arrows used to move the pane only, so the finding on screen and the
   * text it described were in two different places. The document follows the
   * selection, through the shared guard, so a fast click cannot start two
   * navigations and let the later one win.
   */
  function overlayPrevious(): void {
    const next = Math.max(0, overlayPosition - 1);
    const finding = overlayGroup?.findings[next];
    if (finding) void goToFinding(finding);
    updateOverlayPosition(next);
    setReviewNote(null);
  }

  /**
   * Move to the next finding in the overlay group, and take the document with
   * it. See `overlayPrevious` for why the document moves too.
   */
  function overlayNext(): void {
    if (overlayGroup === null) return;
    const next = Math.min(overlayGroup.findings.length - 1, overlayPosition + 1);
    const finding = overlayGroup.findings[next];
    if (finding) void goToFinding(finding);
    updateOverlayPosition(next);
    setReviewNote(null);
  }

  /**
   * Skip one finding in the overlay: record a skip and advance without applying.
   *
   * The inline FindingDetail renders this beside Go to text, not as a second
   * copy under Accept.
   */
  function overlaySkip(finding: Finding): void {
    skipOne(finding);
    const nextPosition = overlayPosition + 1;
    if (overlayGroup && nextPosition < overlayGroup.findings.length) {
      const nextFinding = overlayGroup.findings[nextPosition];
      if (nextFinding) void goToFinding(nextFinding);
      updateOverlayPosition(nextPosition);
    } else {
      closeOverlay();
    }
  }

  /**
   * Ignore one finding in the overlay: move it to the Ignored list and advance.
   *
   * Rendered inline by FindingDetail, beside Go to text.
   */
  function overlayIgnore(finding: Finding): void {
    ignoreFinding(finding);
    /*
     * The ignored finding leaves the group, so every later finding shifts down
     * one index. Select the finding that was at `overlayPosition + 1` *before*
     * the group shrinks, and keep the position at `overlayPosition` so the
     * overlay lands on it. `updateOverlayPosition` (not `setOverlayPosition`)
     * keeps the position ref the re-anchor effect reads in sync.
     */
    const nextFinding = overlayGroup?.findings[overlayPosition + 1] ?? null;
    if (nextFinding) {
      void goToFinding(nextFinding);
      updateOverlayPosition(overlayPosition);
    } else {
      closeOverlay();
    }
  }

  /**
   * Accept one finding in the overlay: apply it immediately, then advance.
   *
   * The change is resolved through the occurrence identity, not through
   * `finding.id`. The finding comes from the document observer's scan and the
   * plan from the preview run, and the two issue separate uuids for the same
   * problem — so an id match never found anything, and a live button did
   * nothing at all.
   *
   * Every way this can fail now says so. Returning silently was the bug: the
   * press looked accepted, and the only evidence was that nothing happened.
   */
  async function overlayAccept(finding: Finding): Promise<void> {
    if (!overlayGroup) {
      return;
    }
    const plan = previewPlanRef.current;
    if (!plan) {
      setReviewNote(
        "No change has been previewed for this document yet. Scan, or press Re-scan now.",
      );
      return;
    }
    const match = changeForFinding(finding, plan, previewFindingsRef.current);
    if (match === null) {
      setReviewNote(
        "The preview proposes no correction for this finding, so there is nothing to apply.",
      );
      return;
    }
    if (match.refusal !== null) {
      setReviewNote(`Cannot apply: ${match.refusal}.`);
      return;
    }
    try {
      const currentState = loadState();
      const currentGovernance = resolveGovernanceProfile(currentState, activeProfile);
      const result = await applyReviewedPlan({
        plan: narrowPlanToChanges(plan, [match.change]),
        currentGovernancePolicyRevision: currentGovernance.version,
        governanceProfile: currentGovernance,
        coverage: reformatResult?.sharedCoverage ?? null,
        allowConflictingApply: false,
        profile: activeProfile,
        capabilities: caps ? toAnalysisCapabilities(caps) : UNPROBED_CAPABILITIES,
        skipRemainingFindingsRefresh: true,
      });
      if (result.applied && result.verified) {
        setReviewNote("Change applied.");
        announcement.announce("Change applied.");
        /*
         * Re-scan after the apply. The write went through the Word API, which
         * moves no selection, so Word fires no documentSelectionChanged and the
         * observer would not refresh on its own. Clearing the recorded preview
         * hash and nudging the observer makes the next settled scan rebuild both
         * the plan and the findings from the changed document, so the next
         * accept verifies against fresh offsets and highlights the right text.
         * Accept is held until that scan reports.
         */
        previewedDocHashRef.current = null;
        setRefreshingAfterApply(true);
        // Immediate: the write fires no selection event, so there is no keystroke
        // burst to debounce — waiting the debounce out only delays the refresh.
        observerRef.current?.onDocumentChanged(true);
        /*
         * Do NOT advance the index here. The nudge above starts a rescan, and
         * that scan no longer reports the finding just applied, so it leaves the
         * live group and every later finding shifts down one index. Advancing
         * against the pre-refresh list therefore overshoots by one once the
         * refreshed list lands — the finding the user should see next is skipped.
         * `resumeOverlayAfterRefreshRef` re-anchors the overlay on this same
         * position when that refreshed list arrives, navigating to whatever now
         * occupies it, or closing when the group is spent.
         */
        resumeOverlayAfterRefreshRef.current = true;
      } else {
        /*
         * Name the cause, not a generic failure. `applyReviewedPlan` reports its
         * refusal in `verificationError` (or per-change in `results`), and the
         * pane previously discarded both, so a refused apply read as "Apply
         * failed" with nothing in the console and nothing to act on (ADR-0069).
         */
        setReviewNote(
          result.verificationError ??
            result.results.find((item) => item.error !== undefined)?.error ??
            "Apply failed. Try again or skip this finding.",
        );
      }
    } catch (error: unknown) {
      setReviewNote(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Accept every change of the overlay group in one plan, then close the overlay.
   *
   * Each finding's change is resolved through the occurrence identity, for the
   * same reason Accept is: the finding on screen and the plan's finding are
   * from different runs, so an id join finds nothing.
   *
   * A finding with no correction is skipped and named; a change Apply would
   * refuse is skipped and its reason reported. Neither is a silent no-op.
   */
  async function overlayAcceptAll(group: FindingTypeGroup): Promise<void> {
    const plan = previewPlanRef.current;
    if (!plan) {
      setReviewNote(
        "No change has been previewed for this document yet. Scan, or press Re-scan now.",
      );
      return;
    }
    const changes: Change[] = [];
    const withoutCorrection: string[] = [];
    const refused: string[] = [];
    group.findings.forEach((finding) => {
      const match = changeForFinding(finding, plan, previewFindingsRef.current);
      if (match === null) {
        withoutCorrection.push(finding.message);
        return;
      }
      if (match.refusal !== null) {
        refused.push(match.refusal);
        return;
      }
      changes.push(match.change);
    });
    if (changes.length === 0) {
      const detail =
        withoutCorrection.length > 0 && refused.length === 0
          ? "The preview proposes no correction for these findings."
          : refused.length > 0
            ? `Cannot apply: ${[...new Set(refused)].join("; ")}.`
            : "The preview proposes no correction for these findings.";
      setReviewNote(detail);
      return;
    }
    if (withoutCorrection.length > 0 || refused.length > 0) {
      setReviewNote(
        `Applying ${changes.length} of ${group.findings.length}. ` +
          `${withoutCorrection.length} had no correction; ${refused.length} refused.`,
      );
    }
    try {
      const currentState = loadState();
      const currentGovernance = resolveGovernanceProfile(currentState, activeProfile);
      const result = await applyReviewedPlan({
        plan: narrowPlanToChanges(plan, changes),
        currentGovernancePolicyRevision: currentGovernance.version,
        governanceProfile: currentGovernance,
        coverage: reformatResult?.sharedCoverage ?? null,
        allowConflictingApply: false,
        profile: activeProfile,
        capabilities: caps ? toAnalysisCapabilities(caps) : UNPROBED_CAPABILITIES,
        skipRemainingFindingsRefresh: true,
      });
      if (result.applied && result.verified) {
        setReviewNote(`Applied ${changes.length} change(s) of this type.`);
        announcement.announce(`Applied ${changes.length} change(s) of this type.`);
        previewedDocHashRef.current = null;
        setRefreshingAfterApply(true);
        observerRef.current?.onDocumentChanged(true);
        closeOverlay();
      } else {
        setReviewNote(
          result.verificationError ??
            result.results.find((item) => item.error !== undefined)?.error ??
            "Apply failed. Try accepting individually.",
        );
      }
    } catch (error: unknown) {
      setReviewNote(error instanceof Error ? error.message : String(error));
    }
  }

  function rescanNow(): void {
    previewedDocHashRef.current = null;
    setReformatResult(null);
    setReviewNote(null);
    observerRef.current?.onDocumentChanged(true);
    announcement.announce("Re-scanning the document.");
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
    page === "llm-settings" ||
    page === "general-settings" ||
    page === "profile" ||
    page === "governance-policy" ||
    page === "consistency" ||
    page === "semantic-review" ||
    page === "semantic-style" ||
    page === "troubleshooting"
  ) {
    /*
     * Breadcrumbs resolve their destination from the parent map (ADR-0137), so a
     * breadcrumb's label is always the page it lands on. The mapped parent is fixed
     * by `PARENT_ROUTE`; the two settings pages return to the page the user was on
     * when they opened them, which is what `resolveParentDestination` resolves.
     * `profile` and `semantic-style` sit under the review they serve.
     */
    return (
      <AppShell
        header={
          <TaskPaneHeader
            activePage={page}
            onNavigate={navigate}
            paneHeader={buildPaneHeader({
              page,
              setup: setupStatusFromState(persisted),
              profile: { name: activeProfile.name, revision: activeProfile.revision },
              semanticProfile: semanticProfileSummary,
              observerStatus: status,
              openSummary: null,
              governanceMarkers: governanceMarkersFromState(persisted),
              trackedEditingEnabled: isTrackedEditingEnabled(),
              selectionChars: semanticReviewStatus?.heldChars ?? null,
              consistencyRan: consistencyResult !== null,
              consistencyComplete: consistencyResult?.coverage.complete ?? false,
            })}
          />
        }
      >
        <Suspense fallback={<LoadingState label="Loading…" />}>
          {page === "llm-settings" ? (
            <LlmSettings onBack={goToParent} parent={parent} />
          ) : page === "general-settings" ? (
            <GeneralSettings onBack={goToParent} parent={parent} />
          ) : page === "profile" ? (
            <Profile onBack={goToParent} capabilities={caps} />
          ) : page === "governance-policy" ? (
            <GovernancePolicy onBack={goToParent} />
          ) : page === "consistency" ? (
            <ConsistencyReview
              onBack={goToParent}
              onOpenSettings={() => navigate("llm-settings")}
              result={consistencyResult}
              onResult={setConsistencyResult}
            />
          ) : page === "semantic-style" ? (
            <SemanticStyle onBack={goToParent} onOpenSettings={() => navigate("llm-settings")} />
          ) : page === "semantic-review" ? (
            <SemanticReview
              onBack={goToParent}
              onOpenSettings={() => navigate("llm-settings")}
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
             * cannot disagree with the review list above it.
             */
            <DebuggingPanel
              onBack={goToParent}
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
              semanticFailureCode={semanticReviewStatus?.failureCode ?? null}
            />
          )}
        </Suspense>
      </AppShell>
    );
  }

  if (page === "landing") {
    const homeState: HomeState = {
      setup: setupStatusFromState(persisted),
      deterministic: status,
      semantic: semanticReviewStatus,
      consistency: consistencyResult,
      activeDeterministicProfile: {
        name: activeProfile.name,
        revision: activeProfile.revision,
      },
      activeSemanticProfile: semanticProfileSummary,
    };
    return (
      <AppShell
        header={
          <TaskPaneHeader
            activePage="landing"
            onNavigate={navigate}
            paneHeader={buildPaneHeader({
              page: "landing",
              setup: homeState.setup,
              profile: { name: activeProfile.name, revision: activeProfile.revision },
              semanticProfile: semanticProfileSummary,
              observerStatus: status,
              openSummary: null,
              governanceMarkers: governanceMarkersFromState(persisted),
              trackedEditingEnabled: isTrackedEditingEnabled(),
              selectionChars: semanticReviewStatus?.heldChars ?? null,
              consistencyRan: consistencyResult !== null,
              consistencyComplete: consistencyResult?.coverage.complete ?? false,
            })}
          />
        }
      >
        <Suspense fallback={<LoadingState label="Loading…" />}>
          <Home state={homeState} onNavigate={navigate} />
        </Suspense>
      </AppShell>
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
  const overlayGroups = projectFindingsByType(findings);
  const overlayGroup = overlayGroups.find((group) => group.key === overlayGroupKey) ?? null;
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
  return (
    <AppShell
      header={
        <TaskPaneHeader
          activePage={page}
          onNavigate={navigate}
          paneHeader={buildPaneHeader({
            page,
            setup: setupStatusFromState(persisted),
            profile: { name: activeProfile.name, revision: activeProfile.revision },
            semanticProfile: semanticProfileSummary,
            observerStatus: status,
            openSummary,
            governanceMarkers: governanceMarkersFromState(persisted),
            trackedEditingEnabled: isTrackedEditingEnabled(),
            selectionChars: semanticReviewStatus?.heldChars ?? null,
            consistencyRan: consistencyResult !== null,
            consistencyComplete: consistencyResult?.coverage.complete ?? false,
          })}
        />
      }
      announcement={announcement.message ?? undefined}
    >
      {page === "review" && (
        <>
          {/*
            Deterministic Review renders inline rather than through a page
            component, so it is the one destination that had to be given its
            breadcrumb explicitly. The parent comes from the same map every other
            page uses (ADR-0137), so the label is the page the press lands on.
          */}
          <Breadcrumb parent={parentRoute("review")} onBack={goToParent} />
          <div className="tf-section">
            <DisclosurePanel
              title={
                <>
                  Findings <span>{findings.length}</span>
                </>
              }
              ariaLabel="Findings section"
              open={findingsOpen}
              onToggle={setFindingsOpen}
            >
              <>
                <p className="tf-sub">
                  {describeOpenFindings(openSummary)}
                  {describeCategoryGroups(openSummary.byGroup) !== "" &&
                    ` / ${describeCategoryGroups(openSummary.byGroup)}`}
                </p>
                <FindingTypeList
                  groups={projectFindingsByType(findings)}
                  onSelect={openOverlayGroup}
                />
                {expiredDecisionCount > 0 && (
                  <p className="tf-sub">
                    {expiredDecisionCount} review decision{expiredDecisionCount === 1 ? "" : "s"}{" "}
                    expired because the document or review policy changed. Review the findings
                    again.
                  </p>
                )}
              </>
            </DisclosurePanel>
          </div>
          <FindingDetailOverlay
            group={overlayGroup}
            finding={overlayGroup?.findings[overlayPosition] ?? null}
            remaining={overlayGroup ? overlayGroup.findings.length - overlayPosition - 1 : 0}
            total={overlayGroup?.findings.length ?? 0}
            position={overlayPosition + 1}
            acceptDisabled={
              coverageIncomplete || remainingScopes.length > 0 || refreshingAfterApply
            }
            acceptDisabledReason={
              coverageIncomplete
                ? "Coverage is incomplete. Re-scan the document before applying changes."
                : remainingScopes.length > 0
                  ? "Not all scopes are checked. Re-scan or adjust the governance policy."
                  : refreshingAfterApply
                    ? "Refreshing findings for the change just applied…"
                    : null
            }
            applyNote={reviewNote}
            onClose={closeOverlay}
            onPrevious={overlayPrevious}
            onNext={overlayNext}
            onAccept={overlayAccept}
            onAcceptAll={overlayAcceptAll}
            onSkip={overlaySkip}
            onIgnore={overlayIgnore}
          />
        </>
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
            onRescan={() => observerRef.current?.onDocumentChanged(true)}
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
                <Button onClick={() => navigate("general-settings")}>Open General Settings</Button>
              )}
            </p>
          )}
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
      {page === "review" && (
        <div className="tf-section tf-section-divider">
          {/*
            Coverage sits at the bottom of the review page, under Ignored findings.
            It qualifies the findings list above, but it is not a warning the user
            must act on before reviewing — it is a statement about the analysis
            that produced the list. Placing it at the bottom keeps the findings
            list as the primary surface and lets the user review first, then
            check coverage when they are ready to apply.
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
            deterministicCoverage={status?.deterministicCoverage ?? null}
            openFindings={openSummary.total}
            open={coverageIncomplete || coverageOpen}
            onToggle={() => setCoverageOpen((open) => !open)}
            onRescan={() => {
              setCoverageOpen(true);
              rescanNow();
            }}
          />
          {remainingScopes.length > 0 && (
            <p className="tf-coverage-blocked" role="status">
              Not checked: {remainingScopes.map(scopeLabel).join(", ")}. Apply stays unavailable
              until the scope is read, or until you stop requiring it in the governance policy.
            </p>
          )}
        </div>
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
          <Button onClick={rescanNow} disabled={status?.phase === "scanning"}>
            {status?.phase === "scanning" ? "Re-scanningâ€¦" : "Re-scan now"}
          </Button>
        </div>
      )}
    </AppShell>
  );
}
