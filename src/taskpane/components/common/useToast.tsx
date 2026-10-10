import React from "react";
import {
  Toast,
  ToastTitle,
  Toaster,
  useId,
  useToastController,
  type ToastIntent,
} from "@fluentui/react-components";

export interface ToasterHandle {
  /** Render this once, inside the provider, wherever the caller lives. */
  toaster: React.ReactNode;
  /** Announce a transient outcome; defaults to an informational toast. */
  notify: (message: string, intent?: ToastIntent) => void;
}

/**
 * The one transient-feedback path (spec §20, ADR-0133). Outcomes that do not
 * need a decision announce through a toast rather than a blocking dialog, and
 * the intent carries the severity so the toast is never colour-only.
 */
export function useToaster(): ToasterHandle {
  const toasterId = useId("toneforge-toaster");
  const { dispatchToast } = useToastController(toasterId);

  const notify = React.useCallback(
    (message: string, intent: ToastIntent = "info"): void => {
      dispatchToast(
        <Toast>
          <ToastTitle>{message}</ToastTitle>
        </Toast>,
        { intent },
      );
    },
    [dispatchToast],
  );

  const toaster = <Toaster toasterId={toasterId} position="bottom-end" />;

  return { toaster, notify };
}
