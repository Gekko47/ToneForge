import React, { Suspense, lazy, useEffect } from "react";
import { ThemeProvider } from "@fluentui/react";
import { ThemeProvider as LocalThemeProvider } from "../theme";
import { createDefaultTheme } from "../fluentTheme";
import { probeWordCapabilities } from "../../word/capabilityProbe";
import { probeOfficeRuntime, formatDiagnostics } from "../../shared/office/diagnostics";
import { createDocumentObserver } from "../../word/documentObserver";
import SmokePanel from "../components/SmokePanel";
import ReformatPanel from "../components/ReformatPanel";
import { loadState } from "../../core/state/persistence";
import { StyleProfileSchema } from "../../core/domain/StyleProfile";

const Settings = lazy(() => import("./Settings"));
const Profile = lazy(() => import("./Profile"));

function resolveActiveProfile(): ReturnType<(typeof StyleProfileSchema)["parse"]> {
  const state = loadState();
  const profile =
    state.profiles.find((item) => item.id === state.activeProfileId) ?? state.profiles[0];
  if (!profile) {
    throw new Error("No style profile found — create one under Style profile first.");
  }
  return StyleProfileSchema.parse(profile);
}

export default function Dashboard(): React.ReactNode {
  const [caps, setCaps] = React.useState<{
    supportsInsertText: boolean;
    supportsReplaceText: boolean;
    supportsInsertParagraph: boolean;
    supportsInsertBreak: boolean;
    supportsStyles: boolean;
    supportsRevisions: boolean;
    hostName: string;
    hostVersion: string | null;
  } | null>(null);
  const [diag, setDiag] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [showProfile, setShowProfile] = React.useState(false);
  const [observerStatus, setObserverStatus] = React.useState<{
    lastScan: string | null;
    dirtyCount: number;
    stale: boolean;
  } | null>(null);

  async function runProbe(): Promise<void> {
    setRunning(true);
    try {
      const result = await probeWordCapabilities();
      setCaps(result);
    } finally {
      setRunning(false);
    }
  }

  function runDiagnostics(): void {
    // Non-destructive: inspects the global Office/Word objects only.
    const d = probeOfficeRuntime();
    const formatted = formatDiagnostics(d);
    // Also surface to the browser console for F12 inspection.
    // eslint-disable-next-line no-console
    console.log(formatted);
    setDiag(formatted);
  }

  useEffect(() => {
    const profile = resolveActiveProfile();
    const observer = createDocumentObserver({
      debounceMs: 300,
      onStatus: (status) => {
        setObserverStatus({
          lastScan: status.lastScan,
          dirtyCount: status.dirtyCount,
          stale: status.stale,
        });
      },
      profile,
    });
    observer.startObserver();
    return () => observer.stopObserver();
  }, []);

  if (showSettings || showProfile) {
    return (
      <Suspense fallback={<div className="tf-card">Loading…</div>}>
        {showSettings ? <Settings /> : <Profile />}
      </Suspense>
    );
  }

  return (
    <LocalThemeProvider>
      <ThemeProvider theme={createDefaultTheme()}>
        <main className="tf-card" tabIndex={0}>
          <h1 className="tf-title">ToneForge</h1>
          <p>Style consistency checks are coming in the next stage.</p>
          <button type="button" onClick={runProbe} disabled={running} style={{ marginTop: "1rem" }}>
            {running ? "Probing…" : "Probe Word capabilities"}
          </button>
          <button
            type="button"
            onClick={runDiagnostics}
            style={{ marginTop: "1rem", marginLeft: "1rem" }}
          >
            Diagnose Office runtime
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            style={{ marginTop: "1rem", marginLeft: "1rem" }}
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => setShowProfile(true)}
            style={{ marginTop: "1rem", marginLeft: "0.5rem" }}
          >
            Style profile
          </button>
          {caps && (
            <pre style={{ marginTop: "1rem", whiteSpace: "pre-wrap" }} aria-live="polite">
              {JSON.stringify(caps, null, 2)}
            </pre>
          )}
          {diag && (
            <pre style={{ marginTop: "1rem", whiteSpace: "pre-wrap" }} aria-live="polite">
              {diag}
            </pre>
          )}
          {observerStatus && (
            <div
              style={{ marginTop: "1rem", fontSize: "0.85rem", opacity: 0.8 }}
              aria-live="polite"
            >
              Last scan: {observerStatus.lastScan ?? "never"}
              {" — "}Dirty: {observerStatus.dirtyCount}
              {observerStatus.stale && " — Stale"}
            </div>
          )}
          <SmokePanel />
          <ReformatPanel profile={resolveActiveProfile()} />
        </main>
      </ThemeProvider>
    </LocalThemeProvider>
  );
}
