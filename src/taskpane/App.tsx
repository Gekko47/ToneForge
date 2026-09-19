import React, { Suspense, lazy } from "react";
import { initializeOffice } from "./officeInit";
import { logger } from "../shared/utils/logger";

const Dashboard = lazy(() => import("./pages/Dashboard"));

export default function App(): React.ReactNode {
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

  if (error) {
    return (
      <div className="tf-card" role="alert">
        <p className="tf-error">{error}</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="tf-card" aria-live="polite">
        <p className="tf-title">ToneForge</p>
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="tf-card">Loading…</div>}>
      <Dashboard />
    </Suspense>
  );
}
