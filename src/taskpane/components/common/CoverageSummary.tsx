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
    color: tokens.colorNeutralForeground2,
  },
});

export interface CoverageSummaryProps {
  checked: number;
  total: number;
  onViewDetails?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * States how much of the requested scope was actually checked (spec §25).
 * Coverage is a discovery claim, so the wording says "checked", never
 * "complete", and a zero total reads as 0% rather than dividing by zero.
 */
export function CoverageSummary({
  checked,
  total,
  onViewDetails,
  className,
}: CoverageSummaryProps): React.ReactNode {
  const styles = useStyles();
  const percent = total > 0 ? Math.round((checked / total) * 100) : 0;
  return (
    <div className={mergeClasses(styles.root, className)}>
      <Text size={300} className={styles.text}>
        {`${percent}% of requested scope checked`}
      </Text>
      {onViewDetails ? (
        <Button appearance="subtle" onClick={onViewDetails}>
          View coverage details
        </Button>
      ) : null}
    </div>
  );
}
