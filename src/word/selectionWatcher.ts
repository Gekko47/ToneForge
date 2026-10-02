import { logger } from "../shared/utils/logger";

/**
 * Follow the caret, without reading the document on every keystroke.
 *
 * **This is the half of live tracking the Office surface provides.** Word has no
 * document-level selection event, but `Office.context` exposes
 * `documentSelectionChanged` through `addHandlerAsync`. Subscribing to it is what
 * turns "press the button to read the selection" into "the pane already knows
 * where the cursor is" — and it is why the caret path in `selectionScope` is
 * reachable at all without a click.
 *
 * Three things this deliberately does not do:
 *
 * 1. **It does not register per component.** Office registers a handler against
 *    the context, not against a caller, so two subscribers would mean two reads
 *    of the same event. One subscription, one callback, and a second `watch` call
 *    replaces the callback rather than adding one.
 * 2. **It does not read on every event.** The host fires this on each caret
 *    movement, including every keystroke, and each read is a `context.sync()`
 *    round trip against the host. The callback is debounced, so typing produces
 *    one read when the user stops rather than one per character.
 * 3. **It does not pretend the event exists.** `watchDocumentSelection` returns
 *    whether it could subscribe, so a caller can fall back to press-to-read and a
 *    host without the event degrades to today's behaviour instead of breaking.
 *
 * ADR-0094 recorded whether a Word host actually fires this as an open question.
 * It is still an open question **about the host**; what is not open any more is
 * what this repository does either way.
 */

/** The event type, as Office spells it. */
const DOCUMENT_SELECTION_CHANGED = "documentSelectionChanged";

/**
 * Long enough that typing a sentence produces one read, short enough that moving
 * the cursor between two paragraphs feels immediate.
 */
const DEFAULT_DEBOUNCE_MS = 250;

let registered: {
  context: Office.Context;
  handler: () => void;
  registrationId: string | null;
} | null = null;

let pending: ReturnType<typeof setTimeout> | null = null;
let notify: (() => void) | null = null;

export interface WatchOptions {
  /** Overridable so a test does not have to wait a real quarter second. */
  debounceMs?: number;
}

/**
 * Subscribe, or re-point the subscription at a new callback.
 *
 * Returns `false` when the host exposes no way to subscribe, or refuses. Both are
 * ordinary answers, not errors: the caller keeps its manual control either way.
 */
export async function watchDocumentSelection(
  onChanged: () => void,
  options: WatchOptions = {},
): Promise<boolean> {
  const context = currentContext();
  if (context === null || typeof context.addHandlerAsync !== "function") {
    logger.warn("This host exposes no document-selection event, so the pane reads on demand", {
      verificationResult: "unavailable",
      refusalCategory: "selection_event_unsupported",
    });
    return false;
  }

  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  // Re-pointing an existing subscription, rather than adding a second one.
  if (registered !== null && registered.context === context) {
    notify = onChanged;
    return true;
  }

  const handler = (): void => {
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      notify?.();
    }, debounceMs);
  };

  try {
    const registration = (await context.addHandlerAsync(DOCUMENT_SELECTION_CHANGED, handler)) as
      { value?: { id?: string } } | undefined;
    registered = {
      context,
      handler,
      registrationId: typeof registration?.value?.id === "string" ? registration.value.id : null,
    };
    notify = onChanged;
    return true;
  } catch {
    logger.warn("Word refused the document-selection subscription", {
      verificationResult: "refused",
      refusalCategory: "selection_event_refused",
    });
    return false;
  }
}

/**
 * Unsubscribe, and drop any debounce still in flight.
 *
 * The pending timer is cleared as well as the handler: a pane unmounting with a
 * read already scheduled would call back into a component that is gone.
 */
export async function stopWatchingDocumentSelection(): Promise<void> {
  if (pending !== null) {
    clearTimeout(pending);
    pending = null;
  }
  notify = null;

  const active = registered;
  registered = null;
  if (active === null) return;

  if (typeof active.context.removeHandlerAsync !== "function") {
    /*
     * A host that subscribes but cannot unsubscribe. The handler then outlives the
     * page that made it, so every later caret move calls back into a component
     * that is gone. There is nothing to do about it and nowhere for the user to
     * go, so it is stated rather than left silent: a leak nobody can see is the
     * one thing the refusal categories exist to prevent.
     */
    logger.warn(
      "This host cannot remove a document-selection handler, so one may outlive the pane",
      {
        verificationResult: "unavailable",
        refusalCategory: "selection_event_unsubscribable",
      },
    );
    return;
  }

  try {
    await active.context.removeHandlerAsync(
      DOCUMENT_SELECTION_CHANGED,
      active.registrationId === null ? undefined : { id: active.registrationId },
    );
  } catch {
    // Unsubscribing is cleanup on a host that may already be tearing down. There
    // is nothing the user can do about a failure here, so it is logged and not
    // propagated: an unmount must not reject.
    logger.warn("Word refused to remove the document-selection subscription", {
      verificationResult: "refused",
      refusalCategory: "selection_event_unsubscribe_failed",
    });
  }
}

/** Whether this module currently holds a subscription. */
export function isWatchingDocumentSelection(): boolean {
  return registered !== null;
}

/**
 * The Office context, or `null` when Office is absent.
 *
 * `globalThis.Office` rather than a bare `Office`, because "there is no runtime
 * here" is an answer this function has to give rather than throw on: the task
 * pane and the Office runtime are different processes' worth of code paths, and
 * unit tests run with no Office at all.
 */
function currentContext(): Office.Context | null {
  const office = (globalThis as { Office?: { context?: Office.Context } }).Office;
  return office?.context ?? null;
}
