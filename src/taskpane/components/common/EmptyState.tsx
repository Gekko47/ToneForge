import React from "react";
import { Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { toneForgeIcons, type ToneForgeIconName } from "../../theme/icons";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: tokens.spacingVerticalS,
    padding: `${tokens.spacingVerticalXL} ${tokens.spacingHorizontalL}`,
  },
  icon: {
    color: tokens.colorNeutralForeground3,
    display: "flex",
  },
  description: {
    color: tokens.colorNeutralForeground2,
  },
});

export interface EmptyStateProps {
  icon?: ToneForgeIconName | undefined;
  title: string;
  description?: string | undefined;
  action?: React.ReactNode;
  className?: string | undefined;
}

/**
 * The one empty state (spec §23). It always names what is empty and, when the
 * user can act, offers the single action that fills it.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): React.ReactNode {
  const styles = useStyles();
  const Icon = icon ? toneForgeIcons[icon] : null;
  return (
    <div className={mergeClasses(styles.root, className)}>
      {Icon ? (
        <span className={styles.icon} aria-hidden="true">
          <Icon />
        </span>
      ) : null}
      <Text weight="semibold">{title}</Text>
      {description ? (
        <Text size={300} className={styles.description}>
          {description}
        </Text>
      ) : null}
      {action}
    </div>
  );
}
