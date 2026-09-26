/**
 * Task-pane navigation bridge shared by ribbon commands and the task pane.
 * The target is a small non-sensitive navigation instruction; it contains no
 * document text and is consumed once when the pane starts.
 *
 * AI Review has exactly one target. It used to have three — one per review
 * mode — and each one auto-started a different review on navigation, so a
 * ribbon button could send a document without the pane having shown its
 * disclosure first. The pane now shows the disclosure and waits for a click.
 *
 * A target carries an optional `action`. "Scan Now" used to open the governance
 * page and stop, so the button named an action the pane never performed; the
 * request travels with the navigation instead, so a ribbon label and the work it
 * starts cannot drift apart.
 */

export const TASKPANE_NAVIGATION_KEY = "ToneForge.TaskpaneNavigation";

export type TaskpaneTarget =
  "governance" | "debugging" | "findings" | "ai-review" | "profile" | "pending-changes";

export interface TaskpaneNavigation {
  target: TaskpaneTarget;
  /**
   * What the pane should do on arrival, beyond opening the destination.
   *
   * `scan` triggers a re-scan. Absent for every other target, which is why an
   * ordinary "open this page" command cannot accidentally start work.
   */
  action?: "scan";
}

const TARGETS: readonly TaskpaneTarget[] = [
  "governance",
  "debugging",
  "findings",
  "ai-review",
  "profile",
  "pending-changes",
];

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function setTaskpaneTarget(target: TaskpaneTarget, action?: "scan"): void {
  getStorage()?.setItem(
    TASKPANE_NAVIGATION_KEY,
    JSON.stringify(action === undefined ? { target } : { target, action }),
  );
}

/**
 * Read and clear the pending navigation instruction.
 *
 * Single consumption is deliberate: a stale instruction left in storage would
 * re-open a page, or re-run a scan, the next time the pane happened to mount.
 */
export function consumeTaskpaneTarget(): TaskpaneNavigation | null {
  const storage = getStorage();
  if (!storage) return null;
  const raw = storage.getItem(TASKPANE_NAVIGATION_KEY);
  storage.removeItem(TASKPANE_NAVIGATION_KEY);
  return parseNavigation(raw);
}

function isTarget(value: unknown): value is TaskpaneTarget {
  return typeof value === "string" && (TARGETS as readonly string[]).includes(value);
}

/**
 * Parse a stored instruction, tolerating the pre-object string form.
 *
 * The value is read back and cleared before it is understood, so a malformed or
 * foreign value is simply dropped rather than blocking the next navigation.
 */
function parseNavigation(raw: string | null): TaskpaneNavigation | null {
  if (raw === null) return null;
  if (isTarget(raw)) return { target: raw };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as { target?: unknown; action?: unknown };
    if (!isTarget(record.target)) return null;
    return record.action === "scan"
      ? { target: record.target, action: "scan" }
      : { target: record.target };
  } catch {
    return null;
  }
}
