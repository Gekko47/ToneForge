import React from "react";
import { Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    /* A long value wraps below its label rather than widening the row past the
       pane (spec §33). */
    flexWrap: "wrap",
    padding: `${tokens.spacingVerticalXXS} 0`,
  },
  label: {
    color: tokens.colorNeutralForeground3,
  },
  value: {
    color: tokens.colorNeutralForeground1,
    textAlign: "right",
    minWidth: 0,
    overflowWrap: "anywhere",
  },
});

export interface MetadataRowProps {
  label: string;
  value: React.ReactNode;
  className?: string | undefined;
}

/**
 * The one metadata treatment (spec §45). A label and its value share a row so
 * every panel's metadata reads the same way, rather than each inventing its own
 * label/value markup.
 */
export function MetadataRow({ label, value, className }: MetadataRowProps): React.ReactNode {
  const styles = useStyles();
  return (
    <div className={mergeClasses(styles.root, className)}>
      <Text size={200} className={styles.label}>
        {label}
      </Text>
      <Text size={200} className={styles.value}>
        {value}
      </Text>
    </div>
  );
}
