/**
 * Sequenced navigation controller.
 *
 * Navigation requests are serialized so a repeated command cannot start a
 * second host operation, stale requests are rejected, and the controller works
 * whether the task pane is open, closed, or mounting.
 */

export type NavigationTargetKind = "finding" | "change";

export interface NavigationRequest {
  requestId: string;
  kind: NavigationTargetKind;
  identity: string;
}

export interface NavigationOutcome {
  requestId: string;
  ok: boolean;
  message: string;
}

export interface NavigationControllerOptions {
  navigate: (request: NavigationRequest) => Promise<NavigationOutcome>;
  onOutcome?: (outcome: NavigationOutcome) => void;
  currentRequestId?: string | null;
}

export interface NavigationController {
  request: (request: NavigationRequest) => Promise<NavigationOutcome>;
  isBusy: () => boolean;
  pendingRequestId: () => string | null;
  acceptRequest: (requestId: string | null) => void;
}

function staleOutcome(requestId: string): NavigationOutcome {
  return { requestId, ok: false, message: "Navigation request is stale; preview again." };
}

export function createNavigationController(
  options: NavigationControllerOptions,
): NavigationController {
  let inFlight: string | null = null;
  let accepted: string | null = options.currentRequestId ?? null;
  let queue: Promise<unknown> = Promise.resolve();

  async function run(request: NavigationRequest): Promise<NavigationOutcome> {
    if (request.requestId === accepted) return staleOutcome(request.requestId);
    if (inFlight !== null) return staleOutcome(request.requestId);
    inFlight = request.requestId;
    try {
      const outcome = await options.navigate(request);
      accepted = request.requestId;
      options.onOutcome?.(outcome);
      return outcome;
    } catch (error: unknown) {
      const outcome: NavigationOutcome = {
        requestId: request.requestId,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
      options.onOutcome?.(outcome);
      return outcome;
    } finally {
      inFlight = null;
    }
  }

  return {
    request: (request) => {
      const next = queue.then(() => run(request));
      queue = next.catch(() => undefined);
      return next;
    },
    isBusy: () => inFlight !== null,
    pendingRequestId: () => inFlight,
    acceptRequest: (requestId) => {
      accepted = requestId;
    },
  };
}
