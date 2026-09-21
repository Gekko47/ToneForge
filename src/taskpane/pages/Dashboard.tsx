import React, { Suspense, lazy } from "react";
import { ThemeProvider } from "@fluentui/react";
import { ThemeProvider as LocalThemeProvider } from "../theme";
import { createDefaultTheme } from "../fluentTheme";
import { probeWordCapabilities } from "../../word/capabilityProbe";
import { probeOfficeRuntime, formatDiagnostics } from "../../shared/office/diagnostics";

const Settings = lazy(() => import("./Settings"));
const Profile = lazy(() => import("./Profile"));

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
              {JSON.stringify(diag, null, 2)}
            </pre>
          )}
        </main>
      </ThemeProvider>
    </LocalThemeProvider>
  );
}
