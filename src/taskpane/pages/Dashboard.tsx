import React from "react";
import { ThemeProvider } from "@fluentui/react";
import { ThemeProvider as LocalThemeProvider } from "../theme";
import { createDefaultTheme } from "../fluentTheme";
import { probeWordCapabilities } from "../../../src/word/capabilityProbe";

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
  const [running, setRunning] = React.useState(false);

  async function runProbe(): Promise<void> {
    setRunning(true);
    try {
      const result = await probeWordCapabilities();
      setCaps(result);
    } finally {
      setRunning(false);
    }
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
          {caps && (
            <pre style={{ marginTop: "1rem", whiteSpace: "pre-wrap" }} aria-live="polite">
              {JSON.stringify(caps, null, 2)}
            </pre>
          )}
        </main>
      </ThemeProvider>
    </LocalThemeProvider>
  );
}
