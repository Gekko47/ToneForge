/**
 * Mounting the task pane, for whichever page was loaded.
 *
 * **One pane, two pages.** `taskpane.html` and `semantic.html` are two pages of
 * the same pane, distinguished only by the `TaskpaneId` they share and the
 * `SourceLocation` each names (ADR-0109). This module is the single place either
 * entry mounts from: a second copy would be a second place for the error
 * boundary, the icon registration, and the root element to drift \u2014 and
 * duplicated bootstrap code is the same class of mistake that produced two panes
 * in the first place.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import { initializeIcons } from "@fluentui/react/lib/Icons";
import App from "./App";
import "./taskpane.css";
import type { DashboardInitialPage } from "./pages/Dashboard";

// Register Fluent UI icons (ChevronDown, etc.) before any component renders.
// Without this call, Fluent UI emits "icon not registered" warnings for every
// ComboBox, Dropdown, and icon-bearing control in the taskpane. The ComboBox
// caret is the default ChevronDown icon once fonts are registered; no custom
// buttonIconProps is needed.
initializeIcons();

function renderFallback(): React.ReactNode {
  return (
    <div role="alert">
      <h2>Something went wrong</h2>
      <p>Reload the add-in to try again.</p>
    </div>
  );
}

function mount(initialPage?: DashboardInitialPage): void {
  const rootEl = document.getElementById("root");
  if (!rootEl) {
    document.body.innerHTML = '<div id="root"></div>';
    return mount(initialPage);
  }
  const root = ReactDOM.createRoot(rootEl);
  root.render(
    <React.StrictMode>
      <ErrorBoundary fallbackRender={renderFallback}>
        {/* Conditional, because this project sets `exactOptionalPropertyTypes`:
            an explicit `undefined` is not an absent prop, and the default is what
            makes the ordinary pane land on the landing page. */}
        {initialPage === undefined ? <App /> : <App initialPage={initialPage} />}
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

/**
 * Mount the pane, on the landing page unless a page is named.
 *
 * The page is not optional in practice: `semantic.html` exists precisely because
 * the context menu is a task pane command, runs no JavaScript of ours, and so
 * cannot ask an already-open pane to navigate. The page it loads is the
 * instruction (ADR-0109).
 */
export function start(initialPage?: DashboardInitialPage): void {
  if (document.readyState === "loading") {
    // Wrapped rather than passed directly: `mount` takes a page, and an event
    // listener is handed an `Event`, so passing it bare would feed the event to
    // the page parameter.
    document.addEventListener("DOMContentLoaded", () => mount(initialPage));
    return;
  }
  mount(initialPage);
}
