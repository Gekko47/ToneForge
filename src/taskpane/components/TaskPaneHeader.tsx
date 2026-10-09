import React, { useEffect, useRef, useState } from "react";
import { IconButton } from "@fluentui/react";
import { nativeButtonProps } from "../nativeField";

export type TaskPaneDestination =
  /** The landing page: the setup checklist. Reachable with no profile at all. */
  | "landing"
  /** Deterministic Review: findings, coverage, and pending changes. */
  | "review"
  | "consistency"
  | "profile"
  /**
   * Semantic Review: the review of a selection against a style.
   *
   * And `semantic-style` beside it, for the style itself. Two destinations, one
   * ribbon command (D10): the button opens Review, and Style is reached from
   * Review's own control or from this drawer. A second ribbon button would have
   * needed a second command claiming a navigation target, and
   * `duplicateNavigationTargets()` fails the build on exactly that — which is the
   * right outcome, because two buttons opening two pages that a user thinks are
   * one feature is how the split reads as a duplicate rather than as a split.
   */
  | "semantic-review"
  | "semantic-style"
  | "governance-policy"
  /**
   * Two settings pages, because they answer two different questions.
   *
   * `llm-settings` is the provider and consent surface: the two LLM roles, the
   * connect-a-provider card, and the redaction/consent section. `general-settings`
   * is the project-wide surface: scanning, tracked editing, and styling. They were
   * one page until the LLM connector change replaced the composed Settings page
   * with the LLM dashboard and left the general sections unmounted; the split
   * restores them and names each page for what it holds.
   */
  | "llm-settings"
  | "general-settings"
  | "troubleshooting";

interface TaskPaneHeaderProps {
  activePage: TaskPaneDestination;
  profileName: string;
  profileRevision: number;
  onNavigate: (destination: TaskPaneDestination) => void;
  /**
   * When the document was last scanned, as an ISO timestamp; `null` for never,
   * and `undefined` where there is no observer to ask.
   *
   * In the header rather than under the findings, because it answers "is what I
   * am looking at current?" before the user has found the list, not after. It
   * used to live on the stale banner, which renders nothing at all unless
   * something is wrong — so the one time the answer is worth having most, the
   * moment a scan has just happened and there is no banner, it was absent.
   */
  lastScan?: string | null | undefined;
}

/**
 * The drawer, in the order a user works in rather than alphabetically.
 *
 * **The two semantic entries are adjacent and read as a pair.** "Semantic Review"
 * and "Semantic Style" sit together because they are two halves of one feature
 * with one thing in common — a style — and the user who has just learned one is
 * about to review with it. Separating them would have put the style editor
 * among the policy pages, which is where it was before the split and where
 * nobody found it.
 */
/**
 * Exported so a routing test can enumerate destinations rather than repeat them.
 *
 * The bug this exists to prevent: a destination was added to the drawer with no
 * branch in `DashboardWithoutProfile`, and every click on it fell through to Home.
 * A test listing destinations by name would have gone stale silently in the same
 * way the routing did; one that reads the list cannot.
 */
export const TASKPANE_DESTINATIONS: readonly {
  key: TaskPaneDestination;
  label: string;
}[] = [
  { key: "landing", label: "Home" },
  { key: "review", label: "Deterministic Review" },
  { key: "consistency", label: "Consistency Review" },
  { key: "profile", label: "Deterministic Style Profile" },
  { key: "semantic-review", label: "Semantic Review" },
  { key: "semantic-style", label: "Semantic Style" },
  { key: "governance-policy", label: "Governance Policy" },
  { key: "llm-settings", label: "LLM Settings" },
  { key: "general-settings", label: "General Settings" },
  { key: "troubleshooting", label: "Troubleshooting" },
];

export default function TaskPaneHeader({
  activePage,
  profileName,
  profileRevision,
  onNavigate,
  lastScan,
}: TaskPaneHeaderProps): React.ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") closeAndRestoreFocus();
    }
    function closeOnOutsideClick(event: MouseEvent): void {
      const target = event.target;
      if (target instanceof Node && !drawerRef.current?.contains(target)) {
        closeAndRestoreFocus();
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("mousedown", closeOnOutsideClick);
    drawerRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("mousedown", closeOnOutsideClick);
    };
  }, [isOpen]);

  function closeAndRestoreFocus(): void {
    setIsOpen(false);
    window.setTimeout(() => triggerRef.current?.querySelector("button")?.focus(), 0);
  }

  function navigate(destination: TaskPaneDestination): void {
    closeAndRestoreFocus();
    onNavigate(destination);
  }

  return (
    <header className="tf-app-header">
      <div ref={triggerRef}>
        <IconButton
          iconProps={{ iconName: "GlobalNavButton" }}
          title="Open navigation"
          ariaLabel="Open navigation"
          aria-expanded={isOpen}
          onClick={() => setIsOpen(true)}
        />
      </div>
      <div className="tf-brand-lockup">
        <h1 className="tf-title">ToneForge</h1>
        <p className="tf-active-profile" title={`${profileName}, revision ${profileRevision}`}>
          <span className="tf-active-profile-label">Active profile</span>
          <strong>{profileName}</strong>
          <span>r{profileRevision}</span>
        </p>
        {/* Plain text, not live: the pane speaks from one live region, and a
            second one here would read the scan time over the announcement. */}
        {lastScan !== undefined && (
          <p className="tf-sub tf-last-scan">
            Last scan: {lastScan === null ? "never" : new Date(lastScan).toLocaleString()}
          </p>
        )}
      </div>
      {isOpen && (
        <div
          className="tf-nav-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeAndRestoreFocus();
          }}
        >
          <div
            ref={drawerRef}
            className="tf-nav-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tf-navigation-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") closeAndRestoreFocus();
              if (event.key === "Tab") {
                const focusable = Array.from(
                  drawerRef.current?.querySelectorAll<HTMLElement>(
                    "button:not([disabled]), [href], [tabindex]",
                  ) ?? [],
                );
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first && last) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last && first) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <header className="tf-nav-panel-header">
              <h2 id="tf-navigation-title">ToneForge navigation</h2>
              <IconButton
                iconProps={{ iconName: "Cancel" }}
                title="Close navigation"
                ariaLabel="Close navigation"
                onClick={closeAndRestoreFocus}
              />
            </header>
            <nav aria-label="Task pane navigation" className="tf-nav-drawer">
              {TASKPANE_DESTINATIONS.map((destination) => (
                <button
                  key={destination.key}
                  type="button"
                  {...nativeButtonProps(activePage === destination.key ? "is-active" : undefined)}
                  aria-current={activePage === destination.key ? "page" : undefined}
                  onClick={() => navigate(destination.key)}
                >
                  {destination.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
