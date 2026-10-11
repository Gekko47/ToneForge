/**
 * Pure header-marker derivation (ADR-0138).
 *
 * The header surfaces pane-specific status markers — scan state, issue counts,
 * staleness, validation warnings — so the user can see at a glance whether the
 * page they are on is healthy. These markers are derived from pane state by
 * this pure mapper, keeping the `PaneHeader` component presentational and
 * testable without React.
 *
 * A marker is a small, labelled status pill with a tone. The mapper returns
 * them in a stable order (most severe first) so the header layout does not
 * shift between renders.
 */

import type { StatusTone, ToneForgeStatus } from "../components/common/StatusBadge";

/** The four severity tones a marker can carry (spec §15). */
export type MarkerTone = StatusTone;

/** A single status marker rendered in the header metadata row. */
export interface PaneMarker {
  /** Machine-readable key for tests and for React keys. */
  key: string;
  /** The reader's label, e.g. "Last scan". Omitted only where the value is self-describing. */
  label?: string | undefined;
  /** The value the marker carries, e.g. "Finance · r3" or "16:04". */
  value: string;
  /** A semantic tone when the value is itself a status (never colour-only, spec §15). */
  tone?: MarkerTone | undefined;
  /** Full value, shown on hover when `value` is truncated. */
  title?: string | undefined;
}

/** Scan phase, matching the observer's status union. */
export type ScanPhase =
  "notStarted" | "scanning" | "fresh" | "clean" | "stale" | "incomplete" | "failed";

/** Input to the marker mapper for a review or home pane. */
export interface ReviewHeaderInput {
  /** The active deterministic profile name, or null when none is active. */
  profileName: string | null;
  /** The active deterministic profile revision, or null when none is active. */
  profileRevision: number | null;
  /** ISO timestamp of the last scan, or null when nothing has been scanned. */
  lastScan: string | null;
  /**
   * The scopes the last scan actually examined, in the order they were read.
   * Empty when nothing has been scanned, or when the scan covered the whole
   * document and the scope is therefore not worth naming.
   */
  examinedScopes: readonly string[];
  /** The current scan phase. */
  phase: ScanPhase;
  /** Whether the document has changed since the last scan. */
  stale: boolean;
  /** Whether the Word host is reachable. */
  hostUnavailable: boolean;
  /** Total deterministic findings from the last scan. */
  findingCount: number;
  /** Findings at "error" severity. */
  errorCount: number;
  /** Findings at "warning" severity. */
  warningCount: number;
  /** Whether the scan covered the whole document. */
  coverageComplete: boolean;
}

/** Input to the marker mapper for a style editor pane. */
export interface StyleHeaderInput {
  /** The active profile name, or null when no profile exists yet. */
  profileName: string | null;
  /** The active profile revision, or null when no profile exists yet. */
  profileRevision: number | null;
  /** Whether there are unsaved changes in the editor. */
  hasDraft: boolean;
}

/** Input to the marker mapper for a settings pane. */
export interface SettingsHeaderInput {
  /** Whether the required LLM provider is configured. */
  llmProviderConfigured: boolean;
  /** Whether the general LLM role binding exists. */
  generalRoleConfigured: boolean;
}

/** Input to the marker mapper for the Semantic Review pane. */
export interface SemanticReviewHeaderInput {
  /** The active semantic style name, or null when none exists. */
  styleName: string | null;
  /** The active semantic style revision, or null when none exists. */
  styleRevision: number | null;
  /** The characters currently held for review, or null when nothing is held. */
  selectionChars: number | null;
  /** Whether an LLM provider is configured. */
  providerConfigured: boolean;
}

/** Input to the marker mapper for the Consistency Review pane. */
export interface ConsistencyHeaderInput {
  /** Whether a consistency run has produced a result. */
  ran: boolean;
  /** Whether the last run covered the whole document. */
  complete: boolean;
  /** Whether an LLM provider is configured. */
  providerConfigured: boolean;
}

/** Input to the marker mapper for a governance pane. */
export interface GovernanceHeaderInput {
  /** The active governance profile name, or null for the house default. */
  profileName: string | null;
  /** The policy revision, or null when nothing has been authored. */
  policyRevision: number | null;
  /** How many ranges the policy protects from change. */
  protectedRangeCount: number;
}

/** Derive header markers for the Semantic Review pane. */
export function semanticReviewHeaderMarkers(input: SemanticReviewHeaderInput): PaneMarker[] {
  const markers: PaneMarker[] = [];

  if (!input.providerConfigured) {
    markers.push({
      key: "provider",
      label: "Provider",
      value: "Required",
      tone: "warning",
      title: "Semantic Review needs a configured LLM provider.",
    });
  }

  markers.push({
    key: "style",
    label: "Semantic style",
    value:
      input.styleName === null
        ? "None yet"
        : input.styleRevision !== null
          ? `${input.styleName} · r${input.styleRevision}`
          : input.styleName,
    tone: "neutral",
    /*
     * The label is the only thing that says what this pill is about, and it is
     * hidden below 370px of strip width. The tooltip is therefore not a
     * truncation aid here — it is the label's stand-in, and it is present in
     * every state rather than only the one that used to need it.
     */
    title:
      input.styleName === null
        ? "No semantic style profile exists yet."
        : `Semantic style profile: ${input.styleName}, revision ${input.styleRevision ?? "—"}.`,
  });

  markers.push({
    key: "selection",
    label: "Selection",
    value:
      input.selectionChars === null ? "Nothing selected" : `${input.selectionChars} characters`,
    tone: "neutral",
    title:
      input.selectionChars === null
        ? "Select text in Word, then read it here."
        : "Characters currently held for review.",
  });

  return markers;
}

/** Derive header markers for the Consistency Review pane. */
export function consistencyHeaderMarkers(input: ConsistencyHeaderInput): PaneMarker[] {
  const markers: PaneMarker[] = [];

  if (!input.providerConfigured) {
    markers.push({
      key: "provider",
      label: "Provider",
      value: "Required",
      tone: "warning",
      title: "The consistency check needs a configured LLM provider.",
    });
  }

  markers.push({
    key: "last-run",
    label: "Last run",
    value: input.ran ? (input.complete ? "Complete" : "Partial") : "Not run yet",
    tone: input.ran ? (input.complete ? "success" : "warning") : "neutral",
    /*
     * Present in every state, not only the two that used to need it: the label
     * hides below 370px, and "Not run yet" is the one state where the value
     * alone does not say what has not happened.
     */
    title: input.ran
      ? input.complete
        ? "The whole document was compared."
        : "The run did not compare the whole document."
      : "The consistency check has not been run.",
  });

  return markers;
}

/** Derive header markers for the Governance pane. */
export function governanceHeaderMarkers(input: GovernanceHeaderInput): PaneMarker[] {
  const markers: PaneMarker[] = [];

  markers.push({
    key: "policy",
    label: "Policy",
    value:
      input.profileName === null
        ? "House default"
        : input.policyRevision !== null
          ? `${input.profileName} · r${input.policyRevision}`
          : input.profileName,
    tone: "neutral",
    /*
     * Present in every state: the label hides below 370px, and "House default"
     * is the one value that does not say whose policy is in force.
     */
    title:
      input.profileName === null
        ? "No authored policy; the house default applies."
        : `Governance policy: ${input.profileName}, revision ${input.policyRevision ?? "—"}.`,
  });

  if (input.protectedRangeCount > 0) {
    markers.push({
      key: "protected",
      label: "Protected",
      value: `${input.protectedRangeCount} range${input.protectedRangeCount === 1 ? "" : "s"}`,
      tone: "neutral",
      title: "Ranges the policy keeps out of the deterministic scan.",
    });
  }

  return markers;
}

/** The status vocabulary label for a scan phase (spec §14). */
const PHASE_STATUS: Readonly<Record<ScanPhase, ToneForgeStatus>> = {
  notStarted: "Not checked",
  scanning: "In progress",
  fresh: "Complete",
  clean: "Complete",
  stale: "Stale",
  incomplete: "Incomplete",
  failed: "Error",
};

/**
 * Format an ISO timestamp as a local clock time, e.g. "16:04".
 *
 * The pane is a local surface: the user is looking at the document in front of
 * them, so the scan time is shown in their own clock rather than in UTC. A
 * timestamp that cannot be parsed yields "Unknown" rather than "Invalid Date",
 * which is what `Date` renders when it is handed a string it does not
 * understand.
 */
function formatScanTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown";
  }
  return parsed.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** A scope name as the reader sees it, e.g. "paragraphs" rather than "paragraph". */
function scopeLabel(scope: string): string {
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

/**
 * Derive header markers for a review or home pane.
 *
 * Order is stable: host error, then scan error, then staleness, then issue
 * counts, then coverage, then the profile. The most severe marker is always
 * first so the header's leftmost position carries the most urgent signal.
 *
 * The last scan and the examined scope are the two facts a reader needs to
 * judge whether the counts below them are about the document they are looking
 * at, so they lead the strip once the pane is healthy.
 */
export function reviewHeaderMarkers(input: ReviewHeaderInput): PaneMarker[] {
  const markers: PaneMarker[] = [];

  if (input.hostUnavailable) {
    markers.push({
      key: "host",
      label: "Word",
      value: "Unavailable",
      tone: "neutral",
      title: "ToneForge cannot reach Word. The document has not changed.",
    });
  }

  if (input.phase === "failed") {
    markers.push({
      key: "scan-error",
      label: "Scan",
      value: "Error",
      tone: "danger",
      title: "The last scan did not complete. Re-scan to get current findings.",
    });
  }

  if (input.stale && input.phase !== "failed") {
    markers.push({
      key: "stale",
      label: "Freshness",
      value: "Stale",
      tone: "warning",
      title: "The document has changed since the last scan.",
    });
  }

  if (input.phase === "scanning") {
    markers.push({
      key: "scanning",
      label: "Scan",
      value: "In progress",
      tone: "neutral",
      title: "The document is being scanned.",
    });
  }

  if (input.lastScan !== null && input.phase !== "scanning") {
    markers.push({
      key: "last-scan",
      label: "Last scan",
      value: formatScanTime(input.lastScan),
      tone: "neutral",
      title: `Last scan at ${formatScanTime(input.lastScan)}.`,
    });
  }

  if (input.examinedScopes.length > 0) {
    markers.push({
      key: "scope",
      label: "Scope",
      value: input.examinedScopes.map(scopeLabel).join(", "),
      tone: "neutral",
      title: `The last scan examined: ${input.examinedScopes.map(scopeLabel).join(", ")}.`,
    });
  }

  if (input.phase === "fresh" && !input.stale && !input.hostUnavailable) {
    if (input.findingCount > 0) {
      markers.push({
        key: "findings",
        label: "Open",
        value: `${input.findingCount} finding${input.findingCount === 1 ? "" : "s"}`,
        tone: input.errorCount > 0 ? "danger" : input.warningCount > 0 ? "warning" : "neutral",
        title:
          input.errorCount > 0
            ? `${input.errorCount} error${input.errorCount === 1 ? "" : "s"}, ${input.warningCount} warning${input.warningCount === 1 ? "" : "s"}`
            : `${input.warningCount} warning${input.warningCount === 1 ? "" : "s"}`,
      });
    } else {
      markers.push({
        key: "clean",
        label: "Open",
        value: "No findings",
        tone: "success",
        title: "No findings from the last scan.",
      });
    }
  }

  if (input.phase === "fresh" && !input.coverageComplete) {
    markers.push({
      key: "coverage",
      label: "Coverage",
      value: "Partial",
      tone: "warning",
      title: "The scan did not cover the whole document.",
    });
  }

  if (input.profileName !== null) {
    markers.push({
      key: "profile",
      label: "Style",
      value:
        input.profileRevision !== null
          ? `${input.profileName} · r${input.profileRevision}`
          : input.profileName,
      tone: "neutral",
      /*
       * Present in every state, not only when a revision exists: the label
       * hides below 370px, and a bare profile name says nothing about which
       * revision of it is in force.
       */
      title: `Deterministic style profile: ${input.profileName}, revision ${input.profileRevision ?? "—"}.`,
    });
  }

  return markers;
}

/**
 * Derive header markers for a style editor pane.
 *
 * A style editor's header is simpler than a review header: the profile name
 * and revision are the primary metadata, and a draft indicator is the only
 * status signal.
 */
export function styleHeaderMarkers(input: StyleHeaderInput): PaneMarker[] {
  const markers: PaneMarker[] = [];

  if (input.hasDraft) {
    markers.push({
      key: "draft",
      label: "Changes",
      value: "Unsaved",
      tone: "warning",
      title: "The profile has unsaved changes.",
    });
  }

  if (input.profileName !== null) {
    markers.push({
      key: "profile",
      label: "Profile",
      value:
        input.profileRevision !== null
          ? `${input.profileName} · r${input.profileRevision}`
          : input.profileName,
      tone: "neutral",
      /*
       * Present in every state, not only when a revision exists: the label
       * hides below 370px, and a bare profile name says nothing about which
       * revision of it is in force.
       */
      title: `Style profile: ${input.profileName}, revision ${input.profileRevision ?? "—"}.`,
    });
  }

  return markers;
}

/**
 * Derive header markers for a settings pane.
 *
 * Settings headers are minimal: a warning marker only when required
 * configuration is missing or invalid. A green "configured" marker is
 * deliberately omitted — it would add noise to a utility pane.
 */
export function settingsHeaderMarkers(input: SettingsHeaderInput): PaneMarker[] {
  const markers: PaneMarker[] = [];

  if (!input.llmProviderConfigured) {
    markers.push({
      key: "llm-missing",
      label: "Provider",
      value: "Required",
      tone: "warning",
      title: "Semantic and Consistency Review need a configured LLM provider.",
    });
  }

  if (input.llmProviderConfigured && !input.generalRoleConfigured) {
    markers.push({
      key: "general-role-missing",
      label: "General role",
      value: "Not bound",
      tone: "neutral",
      title: "Connect a provider to enable semantic review.",
    });
  }

  return markers;
}

/** The status vocabulary label for a scan phase. */
export function scanPhaseStatus(phase: ScanPhase): ToneForgeStatus {
  return PHASE_STATUS[phase];
}
