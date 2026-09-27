/**
 * Navigation guard — bounds how many "go to text" jumps the host sees at once.
 *
 * Selecting a finding now navigates the Word view to it automatically. That makes
 * this a correctness requirement rather than a convenience: the findings toolbar
 * steps one finding at a time, and every keystroke on the arrow key would
 * otherwise fire a `runInWord` selection. Word would settle on whichever request
 * finished last rather than the one the user stopped on.
 *
 * ## What the guard can and cannot do
 *
 * `Office.run` has **no cancellation**. A request already dispatched to Word
 * cannot be withdrawn, so aborting an `AbortController` here does not stop that
 * work; it only stops *us* from believing the result. The real protection against
 * flooding is therefore structural: **at most one jump is in flight, and at most
 * one newer jump is held ready.** Ten rapid selections produce two host calls —
 * the first, and the final destination — rather than ten.
 *
 * The `AbortSignal` is still threaded into the host callback because a
 * `navigate` implementation that *can* be cancelled (a queued rewrite, a future
 * cancellable host path) should honour it, and because discarding a superseded
 * result is required whether or not the work was actually cancelled.
 *
 * Five rules, each pinned by a test in `tests/unit/word/navigationGuard.test.ts`:
 *
 * 1. **One in flight, one queued.** A request arriving while a jump is running
 *    does not start a second. It becomes the pending slot, replacing any older
 *    pending request, and starts when the in-flight one settles.
 * 2. **Superseding invalidates the in-flight result.** The running attempt's
 *    signal is aborted, so when it finishes it resolves as `aborted` and is
 *    never allowed to claim the view.
 * 3. **Re-selecting the current finding is a no-op.** Returns `alreadyAtTarget`
 *    and never reaches the host. The caller reports the host's position through
 *    `invalidate()`, because the user can click elsewhere in the document at any
 *    time and a guard that trusted its own last-known position would skip a jump
 *    the user asked for.
 * 4. **A replayed attempt id is stale.** The id names an *attempt*, not a
 *    destination, so two attempts at the same place get different ids and both
 *    may run.
 * 5. **Failures are outcomes, not throws, and stay retryable.** The host is a
 *    remote system; a refused range is a result the UI renders. Only a success
 *    marks the id accepted, so a transient error cannot lock out a retry.
 *
 * Pure and host-free: no Office, no UI, no storage. The host call is injected,
 * which is also the test for that claim — if this module reached for Office.js
 * internally, none of the above would be constructible without a mock.
 */

export type NavigationTargetKind = "finding" | "change";

export interface NavigationRequest {
  /**
   * Identifies this attempt, not this destination.
   *
   * Two attempts at the same destination carry different ids and may both run;
   * one attempt replayed under the same id is refused (rule 4).
   */
  requestId: string;
  kind: NavigationTargetKind;
  /**
   * The destination, used for coalescing (rule 3).
   *
   * For a finding this is the finding id: two requests naming the same identity
   * are asking for the same place.
   */
  identity: string;
}

export type NavigationFailure = "aborted" | "alreadyAtTarget" | "stale" | "failed";

export interface NavigationOutcome {
  requestId: string;
  ok: boolean;
  /** True only for a jump that actually moved the host selection. */
  moved: boolean;
  message: string;
  failure: NavigationFailure | null;
}

/** What one host navigation attempt reports back. */
export interface HostNavigationResult {
  moved: boolean;
  message: string;
}

export interface NavigationGuardOptions {
  navigate: (request: NavigationRequest, signal: AbortSignal) => Promise<HostNavigationResult>;
  onOutcome?: (outcome: NavigationOutcome) => void;
  /**
   * The destination the host is showing, when known.
   *
   * Supplied from outside rather than tracked here because the host moves on its
   * own: the user can click anywhere in the document at any moment, and a guard
   * that believed otherwise would skip the jump they just asked for.
   */
  currentIdentity?: string | null;
}

export interface NavigationGuard {
  request: (request: NavigationRequest) => Promise<NavigationOutcome>;
  /** The in-flight or queued request id, or null when idle. */
  pendingRequestId: () => string | null;
  isBusy: () => boolean;
  /** Report that the host moved, so the next jump is not coalesced away. */
  invalidate: (identity?: string | null) => void;
  /** Abandon everything in flight or queued. */
  reset: () => void;
}

const SUPERSEDED = "Navigation was superseded by a newer request.";

function failure(requestId: string, kind: NavigationFailure, message: string): NavigationOutcome {
  return { requestId, ok: false, moved: false, message, failure: kind };
}

function success(requestId: string, message: string): NavigationOutcome {
  return { requestId, ok: true, moved: true, message, failure: null };
}

interface InFlight {
  request: NavigationRequest;
  controller: AbortController;
  /** Increments per request; a stale attempt can never match the current one. */
  generation: number;
}

interface Queued {
  request: NavigationRequest;
  generation: number;
  settle: (outcome: NavigationOutcome) => void;
}

export function createNavigationGuard(options: NavigationGuardOptions): NavigationGuard {
  let inFlight: InFlight | null = null;
  let queued: Queued | null = null;
  let generation = 0;
  let accepted: string | null = null;
  let currentIdentity: string | null = options.currentIdentity ?? null;

  function publish(result: NavigationOutcome): NavigationOutcome {
    options.onOutcome?.(result);
    return result;
  }

  /** True when this attempt has been overtaken and must not claim the view. */
  function isStale(record: InFlight): boolean {
    return record.controller.signal.aborted || record.generation !== generation;
  }

  async function runOnHost(record: InFlight): Promise<NavigationOutcome> {
    const { request, controller } = record;
    try {
      const result = await options.navigate(request, controller.signal);
      // Rule 2: the host answered, but a newer request took over while it was
      // running, so the caret may already be somewhere else.
      if (isStale(record)) return failure(request.requestId, "aborted", SUPERSEDED);
      if (result.moved) {
        // Rule 5: only a success marks the attempt accepted.
        accepted = request.requestId;
        currentIdentity = request.identity;
        return success(request.requestId, result.message);
      }
      return failure(request.requestId, "failed", result.message);
    } catch (error: unknown) {
      if (isStale(record)) return failure(request.requestId, "aborted", SUPERSEDED);
      const detail = error instanceof Error ? error.message : String(error);
      return failure(request.requestId, "failed", `Navigation failed: ${detail}`);
    } finally {
      if (inFlight === record) inFlight = null;
    }
  }

  /**
   * Dispatch the queued request when nothing is running.
   *
   * Called after every attempt settles, so a burst of selections drains one at a
   * time and always finishes on the newest one. Re-entrancy is harmless: the
   * guards at the top mean a second call while a jump runs simply returns.
   */
  function pump(): void {
    if (inFlight !== null || queued === null) return;
    const next = queued;
    queued = null;
    const record: InFlight = {
      request: next.request,
      controller: new AbortController(),
      generation: next.generation,
    };
    inFlight = record;
    // `runOnHost` converts every rejection into an outcome, so this catch is a
    // backstop for a defect in the guard itself rather than a normal path.
    const settled = runOnHost(record).catch((): NavigationOutcome =>
      failure(next.request.requestId, "failed", "Navigation could not be completed."),
    );
    void settled.then((result) => {
      next.settle(publish(result));
      pump();
    });
  }

  function enqueue(request: NavigationRequest): Promise<NavigationOutcome> {
    generation += 1;
    const mine = generation;

    // Rule 2: invalidate whatever is running so its result cannot claim the view.
    // The host call itself cannot be withdrawn — see the module note.
    inFlight?.controller.abort();

    // Rule 1: only one jump may wait. A newer selection replaces an older queued
    // one, and the replaced request is told it was superseded rather than left
    // hanging on a promise nobody will settle.
    if (queued !== null) {
      const replaced = queued;
      queued = null;
      replaced.settle(failure(replaced.request.requestId, "aborted", SUPERSEDED));
    }

    return new Promise<NavigationOutcome>((resolve) => {
      queued = { request, generation: mine, settle: resolve };
      pump();
    });
  }

  return {
    request: (request) => {
      // Rule 4: a replayed attempt. A distinct attempt at the same destination
      // carries a distinct id and is not caught here.
      if (request.requestId === accepted) {
        return Promise.resolve(
          publish(failure(request.requestId, "stale", "This navigation already completed.")),
        );
      }
      // Rule 3: the host is already showing this destination, per a fresh report.
      if (currentIdentity === request.identity) {
        return Promise.resolve(
          publish(
            failure(
              request.requestId,
              "alreadyAtTarget",
              "Already showing this location in the document.",
            ),
          ),
        );
      }
      return enqueue(request);
    },
    pendingRequestId: () => inFlight?.request.requestId ?? queued?.request.requestId ?? null,
    isBusy: () => inFlight !== null || queued !== null,
    invalidate: (identity = null) => {
      currentIdentity = identity;
    },
    reset: () => {
      inFlight?.controller.abort();
      inFlight = null;
      if (queued !== null) {
        const abandoned = queued;
        queued = null;
        abandoned.settle(failure(abandoned.request.requestId, "aborted", SUPERSEDED));
      }
      accepted = null;
      currentIdentity = null;
    },
  };
}
