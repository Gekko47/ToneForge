import React from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  tokens,
} from "@fluentui/react-components";

const useStyles = makeStyles({
  danger: {
    backgroundColor: tokens.colorStatusDangerBackground3,
    color: tokens.colorNeutralForegroundOnBrand,
    ":hover": {
      backgroundColor: tokens.colorStatusDangerBackground3Hover,
    },
  },
});

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Paints the confirm button with the danger role (spec §46). */
  danger?: boolean;
}

export interface ConfirmDialogHandle {
  /** Resolves true when the user confirms, false when they cancel or dismiss. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Render this once, inside the provider, wherever the caller lives. */
  dialog: React.ReactNode;
}

/**
 * The one confirmation path (spec §19, ADR-0133). Destructive actions await a
 * promise rather than calling the browser's `confirm`, so the dialog is themed,
 * focus-trapped, and dismissible with Escape.
 */
export function useConfirmDialog(): ConfirmDialogHandle {
  const styles = useStyles();
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null);
  const resolverRef = React.useRef<((value: boolean) => void) | null>(null);

  const confirm = React.useCallback((next: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      // Settle any pending resolver before replacing it, so a new confirmation
      // request does not leave the previous promise hanging forever.
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setOptions(next);
    });
  }, []);

  const settle = React.useCallback((value: boolean): void => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  const dialog = (
    <Dialog
      open={options !== null}
      onOpenChange={(_event, data) => {
        if (!data.open) {
          settle(false);
        }
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{options?.title ?? ""}</DialogTitle>
          <DialogContent>{options?.message ?? ""}</DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => settle(false)}>
              {options?.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              appearance="primary"
              {...(options?.danger ? { className: styles.danger } : {})}
              onClick={() => settle(true)}
            >
              {options?.confirmLabel ?? "Confirm"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );

  return { confirm, dialog };
}
