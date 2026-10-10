import { useRef, useState } from "react";
import { resolveParentDestination, type TaskPaneDestination } from "./routes";

export interface PageNavigation {
  page: TaskPaneDestination;
  navigate: (destination: TaskPaneDestination) => void;
  /** The destination a breadcrumb on `page` should press. */
  parent: TaskPaneDestination | null;
  goToParent: () => void;
}

/**
 * Page state for one dashboard, plus the breadcrumb's parent (ADR-0137).
 *
 * Both dashboards need the same thing — the current page, a `navigate` that
 * records where the user came from, and the destination a breadcrumb should
 * press — so it lives here rather than being copied. The history is a stack
 * because a settings page returns to the page it was opened from, and a single
 * "previous" slot would ping-pong between the two settings pages.
 */
export function usePageNavigation(initial: TaskPaneDestination): PageNavigation {
  const [page, setPage] = useState(initial);
  const historyRef = useRef<readonly TaskPaneDestination[]>([]);
  function navigate(destination: TaskPaneDestination): void {
    if (destination !== page) {
      historyRef.current = [...historyRef.current, page];
    }
    setPage(destination);
  }
  const stack = historyRef.current;
  const previous = stack.length > 0 ? (stack[stack.length - 1] ?? null) : null;
  const parent = resolveParentDestination(page, previous);
  function goToParent(): void {
    if (parent === null) return;
    if (page === "llm-settings" || page === "general-settings") {
      historyRef.current = historyRef.current.slice(0, -1);
    }
    setPage(parent);
  }
  return { page, navigate, parent, goToParent };
}
