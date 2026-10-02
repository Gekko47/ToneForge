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

import { describeError, logger } from "../utils/logger";

export const TASKPANE_NAVIGATION_KEY = "ToneForge.TaskpaneNavigation";

/**
 * The live channel name. One constant, because a name that differs between the
 * writer and the reader is a channel with no traffic in it.
 */
const TASKPANE_CHANNEL = "ToneForge.TaskpaneNavigation.live";

/**
 * The instruction held in memory, for a shared runtime.
 *
 * A shared runtime exists so the task pane and the function commands can share
 * one JavaScript context, and when they do, a plain module variable is the
 * fastest and most reliable channel there is \u2014 no serialization, no storage, no
 * permission to ask for. It is the first path tried for that reason.
 *
 * Module state rather than a `window` property on purpose: a `window` property
 * is shared state that a second copy of this module would silently shadow, and
 * "the pane and the commands loaded different copies" is exactly the class of
 * defect this repository keeps meeting.
 */
let pendingNavigation: TaskpaneNavigation | null = null;

/**
 * The live channel, opened once per document and shared by every caller.
 *
 * `BroadcastChannel` is same-origin and does not use `localStorage`, which is
 * the point: a real Word reported "Tracking Prevention blocked access to storage"
 * and every instruction written to storage was discarded while the write reported
 * success. This route is unaffected by that, and it is the reason a command can
 * still reach a pane that is already open.
 *
 * `null` when the host has no `BroadcastChannel`, which is a normal answer rather
 * than an error \u2014 the in-memory and storage paths still apply, and the caller is
 * told which one carried the instruction.
 */
let liveChannel: BroadcastChannel | null | undefined;

function getLiveChannel(): BroadcastChannel | null {
  if (liveChannel !== undefined) return liveChannel;
  try {
    liveChannel =
      typeof BroadcastChannel === "function" ? new BroadcastChannel(TASKPANE_CHANNEL) : null;
  } catch {
    liveChannel = null;
  }
  return liveChannel;
}

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
  /**
   * Semantic Review — the page that reviews a selection against a style.
   *
   * Renamed from `semantic` in P9. The bare name covered a page that has since
   * become two, and it is the same failure this file's own note on `review`
   * records: a target whose name no longer describes its destination is one
   * whose arrival mapping eventually stops being handled. There is no stored
   * value to migrate — the instruction is written and consumed within a pane
   * session — and `isTarget` drops an unrecognised value rather than guessing,
   * so the worst a stale `semantic` can do is leave the pane on its default page.
   */
  | "semantic-review";

/**
 * What the pane should do on arrival, beyond opening the destination.
 *
 * `scan` re-scans. `read-selection` reads the live Word selection into the
 * Semantic Review page, which is the point of arriving there from the context
 * menu: the user right-clicked *this text* and would otherwise have to select it
 * again. Both are local Word reads — neither sends anything anywhere — so both
 * are safe to run on arrival. Absent for every other target, which is why an
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
  "semantic-review",
];

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Whether an instruction written here is one a pane could actually read.
 *
 * **A successful `setItem` is not proof of a delivered instruction.** A real
 * Word reported "Tracking Prevention blocked access to storage for <URL>" and the
 * write went nowhere, silently: the commands runtime believed it had queued a
 * navigation, the pane never received one, and a context-menu command opened a
 * second blank pane to deliver an instruction to nobody. `setItem` returning
 * normally is not a delivery receipt, so the value is read straight back and
 * compared.
 *
 * The check is also a *guard*, not only a diagnostic. `showTaskpane` calls
 * `Office.addin.showAsTaskpane()`, which opens a pane whether or not there is
 * anything to tell it. When the instruction cannot be stored, opening a pane is
 * pure harm \u2014 a new window showing a page the user did not ask for \u2014 so the
 * caller is told and does not open one.
 */
export function setTaskpaneTarget(target: TaskpaneTarget, action?: TaskpaneAction): boolean {
  const payload: TaskpaneNavigation = action === undefined ? { target } : { target, action };

  /*
   * Three routes, in the order they should be trusted, and any one of them
   * carrying the instruction is enough.
   *
   * `localStorage` was the only route and it is the one this host blocks: a real
   * Word reported "Tracking Prevention blocked access to storage" and the write
   * was discarded while `setItem` reported success. The command then called
   * `showAsTaskpane()`, which opens a pane whether or not anything can tell it
   * where to go, so the user got a blank second window and no navigation.
   *
   * 1. **In memory** \u2014 free and instant when a shared runtime gives the commands
   *    and the pane one JavaScript context, which is what a shared runtime is for.
   * 2. **`BroadcastChannel`** \u2014 same-origin, and unlike storage it is not
   *    something a privacy setting can switch off, so it survives the host that
   *    discarded every `localStorage` write.
   * 3. **`localStorage`** \u2014 kept, because a host that permits it needs no other
   *    channel, and the read-back check below is what stopped the silent discard
   *    passing for a delivery.
   */
  pendingNavigation = payload;

  let announced = false;
  const channel = getLiveChannel();
  if (channel !== null) {
    try {
      channel.postMessage(payload);
      announced = true;
    } catch {
      announced = false;
    }
  }

  const stored = writeToStorage(payload);
  /*
   * Only what actually carried it counts, and nothing is assumed.
   *
   * An earlier version added `sharesJavaScriptContext()` here, reasoning that
   * `Office.addin` existing meant the commands and the pane shared one JavaScript
   * context. It does not: `showAsTaskpane` being available says the runtime is
   * *long-lived*, not that this module instance is shared with the pane. So the
   * function reported a delivery the module variable could not make \u2014 and the
   * symptom in a real Word was a pane that opened and received nothing.
   *
   * So the in-memory route is deliberately **not** counted. It is read by the
   * pane when the two really are one context, and reporting that as a guarantee
   * is exactly the kind of claim a caller cannot check. `announced` and `stored`
   * are both facts; this one is a possibility.
   */
  return announced || stored;
}

/**
 * Store the instruction, and **verify** it.
 *
 * `setItem` returning normally is not a receipt. A host that blocks storage
 * discards the write silently, which is precisely what a real Word did, and a
 * test asserting only that the call did not throw would pass on exactly that
 * host. The value is read back and compared.
 */
function writeToStorage(payload: TaskpaneNavigation): boolean {
  const storage = getStorage();
  if (!storage) return false;

  let stored: string | null = null;
  try {
    storage.setItem(TASKPANE_NAVIGATION_KEY, JSON.stringify(payload));
    stored = storage.getItem(TASKPANE_NAVIGATION_KEY);
  } catch (error) {
    logger.warn("Could not store the task-pane instruction", {
      refusalCategory: "taskpane_navigation_storage_unavailable",
      verificationResult: "refused",
      error: describeError(error),
    });
    return false;
  }

  if (stored === null) {
    logger.warn("This host did not store the task-pane instruction", {
      refusalCategory: "taskpane_navigation_storage_blocked",
      verificationResult: "refused",
      target: payload.target,
      action: payload.action ?? null,
    });
  }
  return stored !== null;
}

/**
 * Read and clear the pending navigation instruction.
 *
 * Single consumption is deliberate: a stale instruction left in storage would
 * re-open a page, or re-run a scan, the next time the pane happened to mount.
 */
export function consumeTaskpaneTarget(): TaskpaneNavigation | null {
  /*
   * **Every** route is cleared on every consume, not only the one that answered.
   *
   * An earlier version returned as soon as the in-memory copy was found, which
   * left the storage copy behind \u2014 so the same instruction was handed out twice:
   * once from memory and again on the next mount, long after the user had acted
   * on it. Single consumption is the property that stops a stale instruction
   * re-opening a page the user has since navigated away from, and it has to hold
   * across every route or it does not hold at all.
   *
   * The in-memory copy is preferred when both are present: it is the route a
   * privacy setting cannot switch off, and the storage copy may be a value a
   * blocked host never really accepted.
   */
  const storage = getStorage();
  const raw = storage?.getItem(TASKPANE_NAVIGATION_KEY) ?? null;
  storage?.removeItem(TASKPANE_NAVIGATION_KEY);

  const held = pendingNavigation;
  pendingNavigation = null;

  return held ?? parseNavigation(raw);
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

  /*
   * The live channel, which is what survives a host that blocks storage.
   *
   * Subscribing rather than only reading on mount is the difference between
   * "the button worked when the pane happened to be closed" and "the button
   * works". A `storage` event never fires on the host that produced "Tracking
   * Prevention blocked access to storage", so on that host the storage listener
   * above was a listener for an event that could not happen.
   */
  const channel = getLiveChannel();
  const onMessage = (event: MessageEvent<unknown>): void => {
    const request = parseNavigationMessage(event.data);
    if (request !== null) listener(request);
  };
  channel?.addEventListener("message", onMessage);

  return () => {
    window.removeEventListener("storage", onStorage);
    channel?.removeEventListener("message", onMessage);
  };
}

/**
 * Read one message off the live channel, validated rather than trusted.
 *
 * The channel is same-origin, but "same origin" is a statement about where a
 * message came from and not about whether it is one of ours, and a listener that
 * casts whatever arrived would let a foreign value reach the navigation mapping.
 * It goes through the same `isTarget`/`isAction` guards as a stored instruction.
 */
function parseNavigationMessage(data: unknown): TaskpaneNavigation | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as { target?: unknown; action?: unknown };
  if (!isTarget(record.target)) return null;
  return isAction(record.action)
    ? { target: record.target, action: record.action }
    : { target: record.target };
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
