/**
 * StaleBanner — prompts re-run when findings are stale.
 */

import React from "react";

export interface StaleBannerProps {
  stale: boolean;
  lastScan: string | null;
  onRescan: () => void;
}

export default function StaleBanner({
  stale,
  lastScan,
  onRescan,
}: StaleBannerProps): React.ReactNode {
  if (!stale) {
    return null;
  }

  return (
    <section
      aria-label="Stale findings"
      style={{
        marginTop: "1rem",
        padding: "0.75rem",
        border: "1px solid #c00",
        borderRadius: "4px",
        backgroundColor: "#fff5f5",
      }}
    >
      <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem", color: "#a4262c" }}>
        Findings are stale
      </h3>
      <p style={{ margin: 0, fontSize: "0.85rem" }}>
        Last scan: {lastScan ? new Date(lastScan).toLocaleString() : "never"}
      </p>
      <p style={{ margin: "0.5rem 0 0 0", fontSize: "0.85rem" }}>
        The document has changed since the last scan. Re-scan to get current findings.
      </p>
      <button type="button" onClick={onRescan} style={{ marginTop: "0.5rem" }}>
        Re-scan now
      </button>
    </section>
  );
}
