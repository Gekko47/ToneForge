import React from "react";
import {
  ProgressBar,
  Spinner,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalL,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  label: {
    color: tokens.colorNeutralForeground2,
  },
});

export interface LoadingStateProps {
  /** Operation-specific text, e.g. "Scanning the document…". */
  label: string;
  /** A 0–1 fraction when the operation can report progress. */
  progress?: number | undefined;
  className?: string | undefined;
}

/**
 * The one loading state (spec §22). It names the operation in progress rather
 * than saying "Loading", and shows a determinate bar when a fraction is known.
 */
export function LoadingState({ label, progress, className }: LoadingStateProps): React.ReactNode {
  const styles = useStyles();
  const determinate = typeof progress === "number";
  return (
    <div
      className={mergeClasses(styles.root, className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className={styles.row}>
        {determinate ? null : <Spinner size="tiny" />}
        <Text size={300} className={styles.label}>
          {label}
        </Text>
      </div>
      {determinate ? <ProgressBar value={progress} /> : null}
    </div>
  );
}
