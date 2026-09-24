/**
 * AiUnavailable — deterministic-only message when no AI provider is configured.
 */

import React from "react";

export interface AiUnavailableProps {
  /** The action the user attempted (e.g. "Review Selection"). */
  action: string;
}

export default function AiUnavailable({ action }: AiUnavailableProps): React.ReactNode {
  return (
    <section
      aria-label="AI unavailable"
      style={{
        marginTop: "1rem",
        padding: "0.75rem",
        border: "1px solid #8a8a8a",
        borderRadius: "4px",
        backgroundColor: "#f5f5f5",
      }}
    >
      <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem" }}>AI Review unavailable</h3>
      <p style={{ margin: 0, fontSize: "0.85rem" }}>
        {action} requires an AI provider. Configure a provider under Settings to enable AI-powered
        review. Deterministic checks remain available.
      </p>
    </section>
  );
}
