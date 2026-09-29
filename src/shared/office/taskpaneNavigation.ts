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
  /**
   * The deterministic review surface.
   *
   * Named `review`, not `governance`, because the destination it names is the
   * one the header calls Deterministic Review. The old name survived the rename
   * and then stopped being handled: the arrival mapping had no `governance`
   * branch, so the "Scan Now" command ran its scan and opened no page at all.
   */
  | "review"
  | "debugging"
  | "findings"
  | "ai-review"
  | "profile"
  | "governance-policy"
  | "pending-changes"
  | "semantic";

/**
 * What the pane should do on arrival, beyond opening the destination.
 *
 * `scan` re-scans. `read-selection` reads the live Word selection into the
 * semantic page, which is the point of arriving there from the context menu: the
 * user right-clicked *this text* and would otherwise have to select it again.
 * Both are local Word reads — neither sends anything anywhere — so both are
 * safe to run on arrival. Absent for every other target, which is why an
 * ordinary "open this page" command cannot accidentally start work.
 */
export type TaskpaneAction = "scan" | "read-selection";

export interface TaskpaneNavigation {
  target: TaskpaneTarget;
  action?: TaskpaneAction;
}

const ACTIONS: readonly TaskpaneAction[] = ["scan", "read-selection"];

const TARGETS: readonly TaskpaneTarget[] = [
  "review",
  "debugging",
  "findings",
  "ai-review",
  "profile",
  "governance-policy",
  "pending-changes",
  "semantic",
];

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function setTaskpaneTarget(target: TaskpaneTarget, action?: TaskpaneAction): void {
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

/**
 * Deliver a command issued while the pane is already open.
 *
 * Consuming only on mount meant a ribbon or context-menu command used after the
 * pane had loaded wrote its instruction to storage and nothing read it — the
 * button did nothing, with no error, and the next mount would pick up a stale
 * instruction from whenever the user happened to reopen the pane. The commands
 * run in a different document from the task pane, which is exactly the case
 * `storage` events exist for: the event fires in the *other* same-origin
 * document, so the pane learns about the command without polling.
 *
 * Returns an unsubscribe function. The listener checks the key itself, because
 * `storage` fires for every key the other document writes.
 */
export function subscribeToTaskpaneTarget(
  listener: (navigation: TaskpaneNavigation) => void,
): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== TASKPANE_NAVIGATION_KEY) return;
    const request = consumeTaskpaneTarget();
    if (request !== null) listener(request);
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

function isTarget(value: unknown): value is TaskpaneTarget {
  return typeof value === "string" && (TARGETS as readonly string[]).includes(value);
}

function isAction(value: unknown): value is TaskpaneAction {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
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
    return isAction(record.action)
      ? { target: record.target, action: record.action }
      : { target: record.target };
  } catch {
    return null;
  }
}
