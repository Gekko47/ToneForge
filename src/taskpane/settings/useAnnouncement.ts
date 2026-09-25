import React from "react";

export interface AnnouncementController {
  /** The most recent settled announcement, or null when there is nothing to say. */
  message: string | null;
  /** Queue a message; a pending earlier message is replaced rather than stacked. */
  announce: (message: string) => void;
  /** Drop any pending message and clear the current announcement. */
  clear: () => void;
}

/**
 * Reduced-noise announcement queue.
 *
 * Live regions announce only the most recent message and only after a short
 * quiet period, so a burst of updates (for example a scan finishing while
 * navigation status changes) collapses into one announcement instead of
 * interrupting a screen reader repeatedly.
 */
export function useAnnouncement(delayMs = 400): AnnouncementController {
  const [message, setMessage] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = React.useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setMessage(null);
  }, []);

  const announce = React.useCallback(
    (next: string): void => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        setMessage(next);
      }, delayMs);
    },
    [delayMs],
  );

  React.useEffect(() => clear, [clear]);

  return { message, announce, clear };
}

export default useAnnouncement;
