/**
 * Initialize Office.js runtime for the taskpane.
 * Idempotent and safe to call multiple times.
 *
 * Resolves only after the host signals readiness via `Office.onReady` (the
 * modern hook used by Word desktop and Word on the web). Falls back to the
 * legacy `Office.initialize` callback for older hosts, and finally falls
 * back to a short grace-period timeout so the taskpane never blocks forever
 * on a missing host.
 */
import { logger } from "../shared/utils/logger";

export async function initializeOffice(): Promise<void> {
  return new Promise<void>((resolve) => {
    const office = (globalThis as unknown as { Office?: Record<string, unknown> }).Office;

    if (!office) {
      // Outside Word (e.g. unit tests or a plain browser), resolve anyway so
      // the UI still renders — the probe will report truthful "unknown" values.
      resolve();
      return;
    }

    let settled = false;
    const finish = (reason: string): void => {
      if (settled) return;
      settled = true;
      logger.info("Office ready", { reason });
      resolve();
    };

    // Modern Word desktop/web exposes `Office.onReady(callback)`. Prefer it
    // over the legacy `Office.initialize` hook because it is called after the
    // runtime is fully initialised and `Office.run` is guaranteed available.
    if (typeof office.onReady === "function") {
      try {
        (office.onReady as (cb: () => void) => void)(() => finish("onReady"));
      } catch {
        finish("onReady-threw");
      }
    } else if (typeof office.initialize === "function") {
      try {
        const original = office.initialize;
        office.initialize = function (...args: unknown[]) {
          try {
            original.apply(office, args);
          } catch {
            /* ignore host callback errors */
          }
          finish("initialize");
        };
      } catch {
        finish("initialize-assign-failed");
      }
    } else {
      finish("no-hook");
    }

    // Safety net: never block the UI indefinitely if the host never fires.
    setTimeout(() => finish("timeout"), 2000);
  });
}
