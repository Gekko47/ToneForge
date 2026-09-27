import { describe, expect, it, vi } from "vitest";
import {
  createNavigationGuard,
  type HostNavigationResult,
  type NavigationOutcome,
  type NavigationRequest,
} from "../../../src/word/navigationGuard";

/**
 * The guard is host-free by design, so these tests inject the host call. That is
 * also the assertion that it stayed host-free: if it reached for Office.js
 * internally, none of this would be constructible without a mock.
 */

function request(requestId: string, identity = "f1"): NavigationRequest {
  return { requestId, kind: "finding", identity };
}

/**
 * A host that holds each jump open until the test releases it.
 *
 * `release()` is sticky: every call after it resolves on a microtask. That
 * matters because the guard dispatches a second jump *after* the first settles,
 * so a one-shot `settle()` would leave that second call waiting forever and the
 * test would hang rather than fail.
 */
function deferredHost(): {
  navigate: (req: NavigationRequest, signal: AbortSignal) => Promise<HostNavigationResult>;
  release: () => void;
  calls: NavigationRequest[];
} {
  const calls: NavigationRequest[] = [];
  const held: (() => void)[] = [];
  let released = false;
  return {
    calls,
    navigate: (req) => {
      calls.push(req);
      return new Promise<HostNavigationResult>((resolve) => {
        const finish = (): void => resolve({ moved: true, message: `moved to ${req.identity}` });
        if (released) queueMicrotask(finish);
        else held.push(finish);
      });
    },
    release: () => {
      released = true;
      const waiting = held.splice(0);
      waiting.forEach((finish) => finish());
    },
  };
}

const moved: HostNavigationResult = { moved: true, message: "moved" };

describe("navigation guard", () => {
  it("performs the jump and reports success", async () => {
    const navigate = vi.fn(async () => moved);
    const guard = createNavigationGuard({ navigate });

    const result = await guard.request(request("a"));

    expect(result).toMatchObject({ ok: true, moved: true, failure: null });
    expect(navigate).toHaveBeenCalledOnce();
    expect(guard.isBusy()).toBe(false);
    expect(guard.pendingRequestId()).toBeNull();
  });

  it("passes an AbortSignal to the host call", async () => {
    const seen: AbortSignal[] = [];
    const guard = createNavigationGuard({
      navigate: async (_req, signal) => {
        seen.push(signal);
        return moved;
      },
    });

    await guard.request(request("a"));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.aborted).toBe(false);
  });

  it("refuses a replayed attempt id once it has succeeded", async () => {
    const navigate = vi.fn(async () => moved);
    const guard = createNavigationGuard({ navigate });

    const first = await guard.request(request("a"));
    const replay = await guard.request(request("a"));

    // Rule 4: the id identifies an attempt, so replaying it is refused. A
    // distinct attempt at the same destination is allowed (next test).
    expect(first.ok).toBe(true);
    expect(replay.failure).toBe("stale");
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("coalesces a second request to the destination it just reached", async () => {
    // The caret is already at f1, so a second jump there is a wasted host round
    // trip. `invalidate()` is how a caller says the host moved on and the jump is
    // wanted again — see the next test.
    const navigate = vi.fn(async () => moved);
    const guard = createNavigationGuard({ navigate });

    await guard.request(request("a", "f1"));
    const again = await guard.request(request("b", "f1"));

    expect(again.failure).toBe("alreadyAtTarget");
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("allows a deliberate re-jump after the caller invalidates the position", async () => {
    const navigate = vi.fn(async () => moved);
    const guard = createNavigationGuard({ navigate });

    await guard.request(request("a", "f1"));
    guard.invalidate(null);
    const again = await guard.request(request("b", "f1"));

    // A distinct attempt id for the same destination is a fresh attempt, not the
    // replay refused by rule 4.
    expect(again.ok).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it("does not re-navigate to the location the host is already showing", async () => {
    // Rule 3. This is the case that matters when stepping to finding 3 and back
    // to finding 2: the caret is already there, so the host call is redundant.
    const navigate = vi.fn(async () => moved);
    const guard = createNavigationGuard({ navigate, currentIdentity: "f2" });

    const result = await guard.request(request("a", "f2"));

    expect(result.failure).toBe("alreadyAtTarget");
    expect(result.moved).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("re-navigates after the caller reports the host moved on its own", async () => {
    // The user can click elsewhere in the document at any time, so a guard that
    // trusted its own last-known position would skip a jump the user asked for.
    const navigate = vi.fn(async () => moved);
    const guard = createNavigationGuard({ navigate, currentIdentity: "f2" });

    guard.invalidate(null);
    const result = await guard.request(request("a", "f2"));

    expect(result.ok).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("supersedes an in-flight jump when a newer request arrives", async () => {
    const host = deferredHost();
    const guard = createNavigationGuard({ navigate: host.navigate });

    const first = guard.request(request("a", "f1"));
    const second = guard.request(request("b", "f2"));

    // The first was already at the host, so it only reports once the host
    // finishes — `Office.run` cannot be recalled. Releasing before awaiting is
    // what makes that observable; the guarantee is that the result is discarded.
    host.release();
    const firstResult = await first;
    // Rule 2: superseded, and never allowed to claim the view.
    expect(firstResult.failure).toBe("aborted");
    expect(firstResult.moved).toBe(false);

    await expect(second).resolves.toMatchObject({ ok: true });
    expect(host.calls).toHaveLength(2);
  });

  it("bounds rapid arrow-through instead of queueing every selection", async () => {
    // The defect the guard exists to prevent: ten keystrokes producing ten
    // selection changes against the host, with Word settling on whichever
    // finished last rather than where the user stopped.
    //
    // `Office.run` cannot be cancelled, so the first request is already at the
    // host by the time the second arrives. The guarantee is therefore structural:
    // at most one in flight and one queued, and the run ends on the newest
    // selection. Two host calls, not ten.
    const host = deferredHost();
    const guard = createNavigationGuard({ navigate: host.navigate });

    const pending = Array.from({ length: 10 }, (_, i) => guard.request(request(`r${i}`, `f${i}`)));

    // The in-flight request is superseded, so the host aborting it is enough to
    // release the slot for the newest selection.
    host.release();
    const results = await Promise.all(pending);

    expect(host.calls.length).toBeLessThanOrEqual(2);
    // The survivor is the last request: the one the user stopped on.
    expect(host.calls[host.calls.length - 1]?.requestId).toBe("r9");
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results[results.length - 1]?.ok).toBe(true);
  });

  it("tells a replaced queued request it was superseded instead of hanging it", async () => {
    // A promise the guard never settles would leave a caller awaiting a result
    // that can never arrive — the exact shape of a frozen UI.
    const host = deferredHost();
    const guard = createNavigationGuard({ navigate: host.navigate });

    const first = guard.request(request("r0", "f0"));
    const replaced = guard.request(request("r1", "f1"));
    const last = guard.request(request("r2", "f2"));

    host.release();
    const results = await Promise.all([first, replaced, last]);

    expect(results[1]?.failure).toBe("aborted");
    expect(results[2]?.ok).toBe(true);
  });

  it("keeps a failed jump retryable under the same request id", async () => {
    // Rule 5. A transient host error must not lock the user out of a retry.
    let attempt = 0;
    const guard = createNavigationGuard({
      navigate: async () => {
        attempt += 1;
        return attempt === 1 ? { moved: false, message: "host refused the range" } : moved;
      },
    });

    const failed = await guard.request(request("a"));
    expect(failed.failure).toBe("failed");
    expect(failed.message).toBe("host refused the range");

    const retried = await guard.request(request("a"));
    expect(retried.ok).toBe(true);
  });

  it("turns a thrown host error into an outcome rather than an exception", async () => {
    // Rule 6. The host is a remote system; a refusal is a result to render.
    const guard = createNavigationGuard({
      navigate: async () => {
        throw new Error("host refused the range");
      },
    });

    const result = await guard.request(request("a"));

    expect(result.failure).toBe("failed");
    expect(result.message).toContain("host refused the range");
  });

  it("reports a non-Error throw without losing the detail", async () => {
    const guard = createNavigationGuard({
      navigate: async () => {
        throw "connection lost";
      },
    });

    const result = await guard.request(request("a"));

    expect(result.failure).toBe("failed");
    expect(result.message).toContain("connection lost");
  });

  it("clears the in-flight slot after a failure so the next request runs", async () => {
    const guard = createNavigationGuard({
      navigate: async () => ({ moved: false, message: "not addressable" }),
    });

    await guard.request(request("a"));

    expect(guard.isBusy()).toBe(false);
    expect(guard.pendingRequestId()).toBeNull();
  });

  it("publishes every outcome to the callback", async () => {
    const seen: NavigationOutcome[] = [];
    const guard = createNavigationGuard({
      navigate: async () => moved,
      onOutcome: (o) => seen.push(o),
      currentIdentity: "f9",
    });

    await guard.request(request("a", "f9"));
    await guard.request(request("b", "f1"));

    expect(seen.map((o) => o.failure)).toEqual(["alreadyAtTarget", null]);
  });

  it("reset abandons the in-flight jump and forgets state", async () => {
    const host = deferredHost();
    const guard = createNavigationGuard({ navigate: host.navigate });

    const pending = guard.request(request("a", "f1"));
    guard.reset();
    // Released before awaiting, because the host cannot be recalled: the
    // abandoned jump only reports once the host itself finishes.
    host.release();

    await expect(pending).resolves.toMatchObject({ failure: "aborted" });
    expect(guard.isBusy()).toBe(false);
    // State is cleared, so the same id is not treated as an already-accepted
    // attempt on the next request.
    const next = guard.request(request("a", "f1"));
    await expect(next).resolves.toMatchObject({ ok: true });
  });
});
