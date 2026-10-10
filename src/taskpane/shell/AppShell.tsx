import React from "react";
import { PageContainer } from "./PageContainer";

export interface AppShellProps {
  /** The application header: brand, navigation, and the active profile indicator. */
  header: React.ReactNode;
  /**
   * The pane's single live region text.
   *
   * Omitted where the page has nothing to announce, so no empty live region is
   * rendered. When present it is the *only* `role="status"` in the pane: every
   * visible message elsewhere is plain text, because two live regions updating
   * in one tick is how a screen reader reads a scan result and an apply refusal
   * in the wrong order (ADR-0062).
   */
  announcement?: string | undefined;
  children: React.ReactNode;
}

/**
 * The one shell every page renders inside (spec §2, §5.3).
 *
 * It owns the single `<main>` landmark, the header slot, the page gutter, and
 * the pane's only live region, so no page repeats the wrapper or adds a second
 * `role="status"` beside it. A page renders its content as `children`.
 *
 * The gutter is a single [`PageContainer`](./PageContainer.tsx:32) here rather
 * than one per page: the pages used to each wrap themselves in `.tf-card`, which
 * nested a second padded card inside this one. The shell now owns the one
 * gutter, and a page renders its content directly.
 *
 * ponytail: routing still lives in `Dashboard.tsx`. Extracting it into the
 * shell is deferred to the Home and surfaces phases, where the two render
 * functions collapse into one. The gate for this phase is the navigation and
 * the labels, both of which this shell serves.
 */
export function AppShell({ header, announcement, children }: AppShellProps): React.ReactNode {
  return (
    <main tabIndex={0}>
      <PageContainer>
        {header}
        {announcement !== undefined && (
          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>
        )}
        {children}
      </PageContainer>
    </main>
  );
}
