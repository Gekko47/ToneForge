import React, { Suspense, lazy } from "react";
import { initializeOffice } from "./officeInit";
import { logger } from "../shared/utils/logger";
import { ThemeProvider as LocalThemeProvider } from "./theme";
import type { DashboardInitialPage } from "./pages/Dashboard";

const Dashboard = lazy(() => import("./pages/Dashboard"));

export interface AppProps {
  /**
   * The page this pane opens on.
   *
   * One pane, more than one page: `taskpane.html` and `semantic.html` both mount
   * this component and differ only here. That is how a task pane command reaches
   * a page — it runs no JavaScript of ours, so the page it loads *is* the
   * instruction (ADR-0109).
   */
  initialPage?: DashboardInitialPage;
}

export default function App({ initialPage }: AppProps): React.ReactNode {
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    initializeOffice()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err) => {
        logger.error("Office initialization failed", {
          message: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) setError("Failed to initialize Office runtime.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const content = error ? (
    <div className="tf-card" role="alert">
      <p className="tf-error">{error}</p>
    </div>
  ) : !ready ? (
    <div className="tf-card" aria-live="polite">
      <p className="tf-title">ToneForge</p>
      <p>Loading…</p>
    </div>
  ) : (
    <Suspense fallback={<div className="tf-card">Loading…</div>}>
      {/*
        Passed conditionally rather than as `initialPage={initialPage}`: this
        project sets `exactOptionalPropertyTypes`, so an explicit `undefined` is
        not the same as an absent prop, and the default on `Dashboard` is what
        makes the ordinary pane land on the landing page.
      */}
      {initialPage === undefined ? <Dashboard /> : <Dashboard initialPage={initialPage} />}
    </Suspense>
  );

  return <LocalThemeProvider>{content}</LocalThemeProvider>;
}
