/**
 * StaleBanner — prompts re-run when findings are stale.
 *
 * A host outage is a different fact from a changed document, and it gets its own
 * branch rather than being folded into "stale". The observer used to set both
 * for an Office failure, which told the user their document had changed when it
 * had not, and sent them to re-scan a document that was fine.
 */

import React from "react";

export interface StaleBannerProps {
  stale: boolean;
  /** The Word host went away; the document itself did not change. */
  hostUnavailable?: boolean;
  onRescan: () => void;
}

export default function StaleBanner({
  stale,
  hostUnavailable = false,
  onRescan,
}: StaleBannerProps): React.ReactNode {
  if (!stale && !hostUnavailable) {
    return null;
  }

  const heading = hostUnavailable ? "Word is unavailable" : "Findings are stale";
  const body = hostUnavailable
    ? "ToneForge cannot reach Word at the moment. The document has not changed; scan again when Word is ready."
    : "The document has changed since the last scan. Re-scan to get current findings.";

  return (
    <section
      aria-label={hostUnavailable ? "Word unavailable" : "Stale findings"}
      className="tf-banner tf-banner-warning"
    >
      <h3 className="tf-banner-heading">{heading}</h3>
      <p>{body}</p>
      {/*
        No scan time here. It moved to the pane header, which is on screen in
        every state rather than only in this one, so the banner no longer has to
        restate it to be self-explanatory — and two copies of a timestamp that
        disagree after a rescan is worse than one.
      */}
      <button type="button" onClick={onRescan}>
        {hostUnavailable ? "Scan again" : "Re-scan now"}
      </button>
    </section>
  );
}
