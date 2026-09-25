import React, { useEffect, useRef, useState } from "react";
import { IconButton } from "@fluentui/react";

export type TaskPaneDestination = "home" | "ai-review" | "profile" | "settings" | "troubleshooting";

interface TaskPaneHeaderProps {
  activePage: TaskPaneDestination;
  profileName: string;
  profileRevision: number;
  onNavigate: (destination: TaskPaneDestination) => void;
}

const DESTINATIONS: readonly {
  key: TaskPaneDestination;
  label: string;
}[] = [
  { key: "home", label: "Document Governance" },
  { key: "ai-review", label: "AI Review" },
  { key: "profile", label: "Style profile" },
  { key: "settings", label: "Settings" },
  { key: "troubleshooting", label: "Troubleshooting" },
];

export default function TaskPaneHeader({
  activePage,
  profileName,
  profileRevision,
  onNavigate,
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
              {DESTINATIONS.map((destination) => (
                <button
                  key={destination.key}
                  type="button"
                  className={activePage === destination.key ? "is-active" : undefined}
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
