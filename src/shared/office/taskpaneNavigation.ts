/**
 * Task-pane navigation bridge shared by ribbon commands and the task pane.
 * The target is a small non-sensitive navigation instruction; it contains no
 * document text and is consumed once when the pane starts.
 *
 * AI Review has exactly one target. It used to have three — one per review
 * mode — and each one auto-started a different review on navigation, so a
 * ribbon button could send a document without the pane having shown its
 * disclosure first. The pane now shows the disclosure and waits for a click.
 */

export const TASKPANE_NAVIGATION_KEY = "ToneForge.TaskpaneNavigation";

export type TaskpaneTarget =
  "governance" | "debugging" | "findings" | "ai-review" | "profile" | "pending-changes";

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function setTaskpaneTarget(target: TaskpaneTarget): void {
  getStorage()?.setItem(TASKPANE_NAVIGATION_KEY, target);
}

export function consumeTaskpaneTarget(): TaskpaneTarget | null {
  const storage = getStorage();
  if (!storage) return null;
  const value = storage.getItem(TASKPANE_NAVIGATION_KEY);
  storage.removeItem(TASKPANE_NAVIGATION_KEY);
  return isTaskpaneTarget(value) ? value : null;
}

function isTaskpaneTarget(value: string | null): value is TaskpaneTarget {
  return (
    value === "governance" ||
    value === "debugging" ||
    value === "findings" ||
    value === "ai-review" ||
    value === "profile" ||
    value === "pending-changes"
  );
}
