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
import { setCachedHostInfo, getCachedHostInfo } from "../shared/office/hostInfo";
import type { OfficeHostInfo } from "../shared/office/hostInfo";

export type { OfficeHostInfo };
export { getCachedHostInfo };

/**
 * Reset the cached host identity. Used by unit tests that swap the Office
 * global between scenarios so the cached onReady info does not leak across
 * tests.
 */
export function resetCachedHostInfo(): void {
  setCachedHostInfo(null);
}

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
    // runtime is fully initialised and `Word.run` is guaranteed available.
    // The callback receives the authoritative host identity; cache it so the
    // probe and diagnostics can report the real host instead of "unknown".
    if (typeof office.onReady === "function") {
      try {
        (office.onReady as (cb: (info: { host?: unknown; platform?: unknown }) => void) => void)(
          (info) => {
            try {
              setCachedHostInfo({
                host: typeof info?.host === "string" ? info.host : null,
                platform: typeof info?.platform === "string" ? info.platform : null,
              });
            } catch {
              setCachedHostInfo(null);
            }
            finish("onReady");
          },
        );
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
