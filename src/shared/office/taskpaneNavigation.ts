/**
 * Task-pane navigation bridge shared by ribbon commands and the task pane.
 * The target is a small non-sensitive navigation instruction; it contains no
 * document text and is consumed once when the pane starts.
 */

export const TASKPANE_NAVIGATION_KEY = "ToneForge.TaskpaneNavigation";

export type TaskpaneTarget =
  | "governance"
  | "findings"
  | "ai-review-selection"
  | "ai-review-paragraph"
  | "ai-review-document"
  | "profile"
  | "pending-changes";

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
    value === "findings" ||
    value === "ai-review-selection" ||
    value === "ai-review-paragraph" ||
    value === "ai-review-document" ||
    value === "profile" ||
    value === "pending-changes"
  );
}
