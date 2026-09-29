/**
 * The one owner of "go to this finding in the document".
 *
 * Every finding card used to call `navigateToFinding` itself. Each card owns a
 * button, each button owned a host call, and `office.run` cannot be cancelled —
 * so clicking one card and then another started two navigations against the
 * same host, and whichever finished last won. The card that reported
 * "selected" was the card that happened to resolve last, not the one the user
 * had most recently asked for.
 *
 * `navigationGuard` already encodes the right contract: one attempt in flight,
 * one queued and replaceable, the superseded attempt aborted and forbidden from
 * claiming the result. It had no caller. Five rules and a full test suite
 * described a guarantee nothing in the product depended on.
 *
 * **One guard, owned here, shared by every surface.** Deterministic Review's
 * findings, Consistency Review's results, and the Semantic tab's proposal all
 * go through this module, so they cannot race each other. A guard per card
 * would have reproduced the original defect with more code.
 *
 * Module state, not context, because the guarantee is about a host that is
 * shared between components rather than about a tree: a card that unmounts
 * while its navigation is in flight must not cancel it, and a card that mounts
 * must not get a fresh guard that knows nothing about the attempt already
 * running.
 */

import {
  createNavigationGuard,
  type NavigationGuard,
  type NavigationOutcome,
} from "../word/navigationGuard";
import { navigateToFinding } from "../word/sourceLocator";
import type { Finding } from "../core/domain/Finding";

/** What one card shows after asking to be taken to its finding. */
export interface GoToOutcome {
  moved: boolean;
  message: string;
  /**
   * True when this attempt was superseded or abandoned rather than answered.
   *
   * A card whose attempt lost the race must not claim either success or
   * failure: it was replaced by a newer request, and saying "selected" would
   * contradict what the pane just did.
   */
  superseded: boolean;
}

/** The latest outcome, for tests and for a surface that wants to render it. */
let lastOutcome: NavigationOutcome | null = null;

const guard: NavigationGuard = createNavigationGuard({
  navigate: async (request, signal) => {
    /*
     * The finding is looked up from the request rather than captured in a
     * closure, so a queued request navigates to what it asked for and not to
     * whatever the newest caller happened to be holding.
     */
    const finding = findingsByRequestId.get(request.requestId);
    if (finding === undefined) {
      return { moved: false, message: "That finding is no longer available." };
    }
    if (signal.aborted) {
      // The guard aborts the superseded attempt. A host call is not itself
      // cancellable, so the check happens before it is started rather than
      // pretending to stop it afterwards.
      return { moved: false, message: "Navigation was superseded." };
    }
    const result = await navigateToFinding({ finding });
    return { moved: result.navigated, message: result.message };
  },
  onOutcome: (outcome) => {
    lastOutcome = outcome;
  },
});

/** The findings the in-flight and queued attempts are for. */
const findingsByRequestId = new Map<string, Finding>();

/** Monotonic, so two attempts at the same finding are never the same attempt. */
let attempt = 0;

export async function goToFinding(finding: Finding): Promise<GoToOutcome> {
  attempt += 1;
  const requestId = `go-to-${finding.id}-${attempt}`;
  findingsByRequestId.set(requestId, finding);

  const outcome = await guard.request({
    requestId,
    kind: "finding",
    identity: finding.id,
  });

  findingsByRequestId.delete(requestId);

  return {
    moved: outcome.moved,
    message: outcome.message,
    superseded: outcome.failure === "aborted" || outcome.failure === "stale",
  };
}

/**
 * The host moved on its own.
 *
 * The user can click anywhere in the document at any moment. Without this the
 * guard would coalesce away a jump to the place they are already looking,
 * because it still believed it had put them there last.
 */
export function reportHostMoved(): void {
  guard.invalidate(null);
}

/** Abandon everything in flight or queued. For a pane that is going away. */
export function resetFindingNavigation(): void {
  guard.reset();
  findingsByRequestId.clear();
  lastOutcome = null;
}

/** The last published outcome, for tests. */
export function lastNavigationOutcome(): NavigationOutcome | null {
  return lastOutcome;
}
