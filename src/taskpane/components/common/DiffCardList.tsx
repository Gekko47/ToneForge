import React from "react";
import { Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  caption: {
    margin: 0,
    color: tokens.colorNeutralForeground3,
  },
  list: {
    listStyleType: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  card: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  field: {
    margin: 0,
    marginBottom: tokens.spacingVerticalXS,
  },
  /*
   * Two columns only for the before/after comparison, and only above 480px
   * (plan §2.3/§33). Below that the pane is routinely docked narrow, and two
   * ~150px columns of prose is worse than no comparison at all — so the values
   * stack and each keeps its own label.
   */
  values: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: tokens.spacingVerticalXS,
    "@media (min-width: 480px)": {
      gridTemplateColumns: "1fr 1fr",
      gap: tokens.spacingHorizontalM,
    },
  },
  value: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  valueLabel: {
    color: tokens.colorNeutralForeground3,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  valueText: {
    overflowWrap: "anywhere",
  },
});

export interface DiffCardListChange {
  readonly field: string;
  readonly from: string;
  readonly to: string;
}

export interface DiffCardListProps {
  /** Names the comparison and its size, e.g. "3 field change(s) between v1 and v2". */
  caption: string;
  leftLabel: string;
  rightLabel: string;
  changes: readonly DiffCardListChange[];
  className?: string | undefined;
}

/**
 * The one before/after comparison treatment (plan §2.3, §33).
 *
 * A card list, not a table: the table it replaces was three columns wide in a
 * pane that can be 320px across, so every cell was one word wide and the
 * wrapper scrolled horizontally. One card per field gives the comparison the
 * full width it needs, and the two values sit side by side only when there is
 * room for them.
 */
export function DiffCardList({
  caption,
  leftLabel,
  rightLabel,
  changes,
  className,
}: DiffCardListProps): React.ReactNode {
  const styles = useStyles();
  return (
    <div className={mergeClasses(styles.root, className)}>
      <Text size={200} className={styles.caption}>
        {caption}
      </Text>
      <ul className={styles.list}>
        {changes.map((change) => (
          <li key={change.field} className={styles.card}>
            <Text as="h4" size={300} weight="semibold" className={styles.field}>
              {change.field}
            </Text>
            <div className={styles.values}>
              <div className={styles.value}>
                <Text size={200} className={styles.valueLabel}>
                  {leftLabel}
                </Text>
                <Text size={300} className={styles.valueText}>
                  {change.from}
                </Text>
              </div>
              <div className={styles.value}>
                <Text size={200} className={styles.valueLabel}>
                  {rightLabel}
                </Text>
                <Text size={300} className={styles.valueText}>
                  {change.to}
                </Text>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
