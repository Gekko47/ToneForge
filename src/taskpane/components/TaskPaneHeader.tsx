import React, { useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { Dismiss24Regular, Navigation24Regular } from "@fluentui/react-icons";
import { HOME_ROUTE, NAV_GROUPS, TASKPANE_DESTINATIONS, type TaskPaneDestination } from "../routes";

/*
 * Re-exported from the single `ROUTES` source (ADR-0131) so existing importers
 * keep working while the drawer, Home, and any breadcrumb read one list. The
 * type and the enumeration used to live here; they now live in `routes.ts`.
 */
export { TASKPANE_DESTINATIONS, type TaskPaneDestination };

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
        <Button
          appearance="subtle"
          icon={<Navigation24Regular />}
          title="Open navigation"
          aria-label="Open navigation"
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
              <Button
                appearance="subtle"
                icon={<Dismiss24Regular />}
                title="Close navigation"
                aria-label="Close navigation"
                onClick={closeAndRestoreFocus}
              />
            </header>
            <nav aria-label="Task pane navigation" className="tf-nav-drawer">
              <Button
                key={HOME_ROUTE.key}
                appearance="subtle"
                className={activePage === HOME_ROUTE.key ? "is-active" : undefined}
                aria-current={activePage === HOME_ROUTE.key ? "page" : undefined}
                onClick={() => navigate(HOME_ROUTE.key)}
              >
                {HOME_ROUTE.label}
              </Button>
              {NAV_GROUPS.map((group) => (
                <div key={group.key} className="tf-nav-group" role="group" aria-label={group.label}>
                  <h3 className="tf-nav-group-label">{group.label}</h3>
                  {group.routes.map((route) => (
                    <Button
                      key={route.key}
                      appearance="subtle"
                      className={activePage === route.key ? "is-active" : undefined}
                      aria-current={activePage === route.key ? "page" : undefined}
                      onClick={() => navigate(route.key)}
                    >
                      {route.label}
                    </Button>
                  ))}
                </div>
              ))}
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
