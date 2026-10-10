import React from "react";
import { Button, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  text: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    minWidth: 0,
  },
  caption: {
    color: tokens.colorNeutralForeground3,
  },
  label: {
    color: tokens.colorNeutralForeground1,
  },
});

export interface ProfileIndicatorProps {
  /** What kind of profile this is, e.g. "Active style". */
  kind: string;
  /** The profile's name, or a statement that none is active. */
  label: string;
  onManage?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * States which profile is in force and offers the one action that changes it
 * (spec §12, §45). The caption names the kind so the same treatment can be
 * reused for the semantic and governance profiles without ambiguity.
 */
export function ProfileIndicator({
  kind,
  label,
  onManage,
  className,
}: ProfileIndicatorProps): React.ReactNode {
  const styles = useStyles();
  return (
    <div className={mergeClasses(styles.root, className)}>
      <div className={styles.text}>
        <Text size={200} className={styles.caption}>
          {kind}
        </Text>
        <Text weight="semibold" className={styles.label}>
          {label}
        </Text>
      </div>
      {onManage ? (
        <Button appearance="subtle" onClick={onManage}>
          Manage
        </Button>
      ) : null}
    </div>
  );
}
