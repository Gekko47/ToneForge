import React from "react";
import { Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    position: "sticky",
    bottom: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  summary: {
    color: tokens.colorNeutralForeground2,
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
  },
});

export interface StickyActionBarProps {
  /** A short statement of what the actions will do, e.g. "3 changes ready". */
  summary?: string | undefined;
  children: React.ReactNode;
  className?: string | undefined;
}

/**
 * The one sticky action region (spec §28). It keeps the commit action in reach
 * while the user scrolls a long list, and states the consequence beside it.
 */
export function StickyActionBar({
  summary,
  children,
  className,
}: StickyActionBarProps): React.ReactNode {
  const styles = useStyles();
  return (
    <div className={mergeClasses(styles.root, className)}>
      {summary ? (
        <Text size={300} className={styles.summary}>
          {summary}
        </Text>
      ) : null}
      <div className={styles.actions}>{children}</div>
    </div>
  );
}
