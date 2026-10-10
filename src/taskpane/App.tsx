import React, { Suspense, lazy } from "react";
import { Button } from "@fluentui/react-components";
import { initializeOffice } from "./officeInit";
import { logger } from "../shared/utils/logger";
/*
 * From the module, not the `./theme` barrel: the barrel also re-exports the
 * icon map and the token object, and this is the eager entry chunk. The icons
 * belong to the lazy page chunks that render them.
 */
import { FluentV9Provider } from "./theme/FluentV9Provider";
/*
 * Imported from their modules, not the `./components/common` barrel: the barrel
 * also re-exports `ConfirmDialog` (Fluent `Dialog`) and `useToaster` (Fluent
 * `Toaster`), and this is the eager entry chunk. Pulling the barrel in here put
 * both portals in the initial bundle for a page that renders neither.
 */
import { ErrorState } from "./components/common/ErrorState";
import { LoadingState } from "./components/common/LoadingState";
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
    <ErrorState
      title="ToneForge could not start"
      message={error}
      primaryRecoveryAction={
        <Button appearance="primary" onClick={() => window.location.reload()}>
          Reload the pane
        </Button>
      }
    />
  ) : !ready ? (
    <LoadingState label="Starting ToneForge…" />
  ) : (
    <Suspense fallback={<LoadingState label="Loading…" />}>
      {/*
        Passed conditionally rather than as `initialPage={initialPage}`: this
        project sets `exactOptionalPropertyTypes`, so an explicit `undefined` is
        not the same as an absent prop, and the default on `Dashboard` is what
        makes the ordinary pane land on the landing page.
      */}
      {initialPage === undefined ? <Dashboard /> : <Dashboard initialPage={initialPage} />}
    </Suspense>
  );

  return <FluentV9Provider>{content}</FluentV9Provider>;
}
