/**
 * Home command-centre state — pure computation from raw pane state.
 *
 * Home reads existing state only (plan §6, ADR-0132). It owns no storage and
 * starts no work. This module maps the raw state the caller already holds into
 * the card states the Home page renders, so the mapping is testable without a
 * host and the component stays a pure function of its props.
 *
 * The three card states follow spec §11.1–§11.3. The status vocabulary is the
 * one in [`STATUS_VOCABULARY`](../components/common/StatusBadge.ts:9); the tone
 * is the severity in spec §15.
 */

import type { DocumentObserverStatus } from "../../word/documentObserver";
import type { ConsistencyReport } from "../../analysis/consistency/contracts/report";
import type { SetupStatus } from "../setupStatus";
import type { StatusTone } from "../components/common/StatusBadge";
import type { TaskPaneDestination } from "../components/TaskPaneHeader";

/** The raw state Home needs, all of which the caller already holds. */
export interface HomeState {
  setup: SetupStatus;
  /** Null when no deterministic profile exists, so no scan has run. */
  deterministic: DocumentObserverStatus | null;
  /** Null when the semantic page has never reported a selection. */
  semantic: { heldChars: number | null; preservationRefused: boolean } | null;
  /** Null when no consistency check has completed. */
  consistency: ConsistencyReport | null;
  activeDeterministicProfile: { name: string; revision: number } | null;
  activeSemanticProfile: { name: string; revision: number } | null;
}

/** One card's rendered state. */
export interface HomeCardState {
  status: StatusTone;
  statusText: string;
  profileLabel?: string | undefined;
  metadata?: string | undefined;
  primaryAction: { label: string; disabled: boolean; destination?: TaskPaneDestination };
}

/** The computed card states plus the attention line, if any. */
export interface HomeCards {
  deterministic: HomeCardState;
  semantic: HomeCardState;
  consistency: HomeCardState;
  attention: string | null;
}

/**
 * Map the deterministic scan phase to a card state (spec §11.1).
 *
 * The phase is the observer's own account of what it did, so the card cannot
 * claim more than the scan did. `stale` is read alongside the phase because a
 * fresh scan of a changed document is still stale until the next run.
 */
function deterministicCard(
  status: DocumentObserverStatus | null,
  profile: { name: string; revision: number } | null,
): HomeCardState {
  if (status === null || profile === null) {
    return {
      status: "neutral",
      statusText: "Not checked",
      primaryAction: { label: "Run review", disabled: profile === null },
    };
  }

  const findings = status.findings.length;
  const profileLabel = `${profile.name} r${profile.revision}`;

  if (status.phase === "scanning") {
    return {
      status: "neutral",
      statusText: "In progress",
      profileLabel,
      primaryAction: { label: "View review", disabled: true },
    };
  }
  if (status.phase === "stale" || status.stale) {
    return {
      status: "warning",
      statusText: "Stale",
      profileLabel,
      metadata: "Document changed since last review",
      primaryAction: { label: "Run again", disabled: false },
    };
  }
  if (status.phase === "incomplete" || status.deterministicCoverage?.complete === false) {
    return {
      status: "warning",
      statusText: "Incomplete",
      profileLabel,
      metadata: "Some requested document scope was not checked",
      primaryAction: { label: "View review", disabled: false },
    };
  }
  if (status.phase === "failed") {
    return {
      status: "danger",
      statusText: "Error",
      profileLabel,
      metadata: "The last review could not be completed",
      primaryAction: { label: "Run review", disabled: false },
    };
  }
  if (findings === 0) {
    return {
      status: "success",
      statusText: "Complete",
      profileLabel,
      metadata: "No deterministic issues",
      primaryAction: { label: "View review", disabled: false },
    };
  }
  return {
    status: "warning",
    statusText: "Needs review",
    profileLabel,
    metadata: `${findings} finding${findings === 1 ? "" : "s"}`,
    primaryAction: { label: "Continue review", disabled: false },
  };
}

/**
 * Map the semantic selection state to a card state (spec §11.2).
 *
 * `heldChars` is the character count of the selection the semantic page
 * reported. `preservationRefused` means the proposal failed the preservation
 * check, so the user must review again before applying.
 */
function semanticCard(
  semantic: { heldChars: number | null; preservationRefused: boolean } | null,
  profile: { name: string; revision: number } | null,
): HomeCardState {
  if (profile === null) {
    return {
      status: "neutral",
      statusText: "Unavailable",
      metadata: "No active Semantic Style",
      primaryAction: { label: "Choose style", disabled: false, destination: "semantic-style" },
    };
  }

  const profileLabel = `${profile.name} r${profile.revision}`;

  if (semantic === null || semantic.heldChars === null) {
    return {
      status: "neutral",
      statusText: "Not checked",
      profileLabel,
      metadata: "Select text in Word to review its semantic style.",
      primaryAction: { label: "Review selection", disabled: true },
    };
  }
  if (semantic.preservationRefused) {
    return {
      status: "warning",
      statusText: "Needs review",
      profileLabel,
      metadata: "Proposal failed the preservation check — review again before applying",
      primaryAction: { label: "Review again", disabled: false, destination: "semantic-review" },
    };
  }
  const chars = semantic.heldChars;
  return {
    status: "warning",
    statusText: "Needs review",
    profileLabel,
    metadata: `${chars} character${chars === 1 ? "" : "s"} selected`,
    primaryAction: { label: "Review selection", disabled: false, destination: "semantic-review" },
  };
}

/**
 * Map the consistency report to a card state (spec §11.3).
 *
 * `null` means no check has completed. The report's own `issues` array is the
 * count, and `coverage.complete` says whether the run examined everything.
 */
function consistencyCard(report: ConsistencyReport | null): HomeCardState {
  if (report === null) {
    return {
      status: "neutral",
      statusText: "Not checked",
      primaryAction: { label: "Run consistency check", disabled: false },
    };
  }

  const issues = report.issues.length;
  const lastChecked = formatTime(report.finishedAt);

  if (issues === 0) {
    return {
      status: "success",
      statusText: "Complete",
      metadata: `No presented inconsistencies · Last checked ${lastChecked}`,
      primaryAction: { label: "View review", disabled: false },
    };
  }
  return {
    status: "warning",
    statusText: "Needs review",
    metadata: `${issues} unresolved issue${issues === 1 ? "" : "s"} · Last checked ${lastChecked}`,
    primaryAction: { label: "Review issues", disabled: false },
  };
}

/** Format an ISO timestamp as HH:MM for the card metadata. */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Compute the three card states and the attention line from raw pane state.
 *
 * The attention line is the deterministic staleness, because that is the one
 * fact that means a previously-clean review is no longer true. It is a single
 * line, not a card, because it is a property of the last review rather than a
 * mode the user can start.
 */
export function computeHomeCards(state: HomeState): HomeCards {
  return {
    deterministic: deterministicCard(state.deterministic, state.activeDeterministicProfile),
    semantic: semanticCard(state.semantic, state.activeSemanticProfile),
    consistency: consistencyCard(state.consistency),
    attention:
      state.deterministic?.stale === true ? "Report changed since last deterministic review" : null,
  };
}
