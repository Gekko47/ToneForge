/**
 * Initialize Office.js runtime for the taskpane.
 * Idempotent and safe to call multiple times.
 */

export async function initializeOffice(): Promise<void> {
  return new Promise((resolve, reject) => {
    const office = (globalThis as unknown as { Office?: { initialize?: () => void } }).Office;
    if (!office) {
      reject(new Error("Office.js is not loaded"));
      return;
    }
    office.initialize?.();
    resolve();
  });
}
