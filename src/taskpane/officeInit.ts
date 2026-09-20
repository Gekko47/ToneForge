/**
 * Initialize Office.js runtime for the taskpane.
 * Idempotent and safe to call multiple times.
 *
 * Office.js exposes a global `Office` object whose `initialize` callback is
 * invoked by the host when the runtime is ready. We resolve only after that
 * callback has fired (or after a short grace period if it never does), so the
 * taskpane never blocks forever on a missing host.
 */
export async function initializeOffice(): Promise<void> {
  return new Promise<void>((resolve) => {
    const office = (globalThis as unknown as { Office?: Record<string, unknown> }).Office;

    if (!office) {
      // Outside Word (e.g. unit tests or a plain browser), resolve anyway so
      // the UI still renders — the probe will report truthful "unknown" values.
      resolve();
      return;
    }

    // Let the host signal readiness via the standard Office.initialize hook.
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };

    if (typeof office.initialize === "function") {
      try {
        // Office.initialize is the host's readiness callback. Replace it so
        // our resolve runs when the host fires it.
        const original = office.initialize;
        office.initialize = function (...args: unknown[]) {
          try {
            original.apply(office, args);
          } catch {
            /* ignore host callback errors */
          }
          finish();
        };
        // If the host already fired initialize before we replaced it, finish now.
        finish();
      } catch {
        finish();
      }
    } else {
      finish();
    }

    // Safety net: never block the UI indefinitely if the host never fires.
    setTimeout(finish, 2000);
  });
}
