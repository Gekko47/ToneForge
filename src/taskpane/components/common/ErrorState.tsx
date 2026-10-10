import React from "react";
import { Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { toneForgeIcons } from "../../theme/icons";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalL,
    border: `1px solid ${tokens.colorStatusDangerBorder1}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorStatusDangerBackground1,
  },
  heading: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    color: tokens.colorStatusDangerForeground1,
  },
  message: {
    color: tokens.colorNeutralForeground1,
  },
  diagnostic: {
    color: tokens.colorNeutralForeground3,
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
  },
});

export interface ErrorStateProps {
  title: string;
  message: string;
  primaryRecoveryAction: React.ReactNode;
  secondaryAction?: React.ReactNode;
  diagnosticId?: string | undefined;
  className?: string | undefined;
}

/**
 * The one error state (spec §24). It is announced as an alert, states what
 * failed, and always offers a recovery action — an error with no way forward is
 * not an error state, it is a dead end.
 */
export function ErrorState({
  title,
  message,
  primaryRecoveryAction,
  secondaryAction,
  diagnosticId,
  className,
}: ErrorStateProps): React.ReactNode {
  const styles = useStyles();
  const Icon = toneForgeIcons.error;
  return (
    <section role="alert" className={mergeClasses(styles.root, className)}>
      <div className={styles.heading}>
        <span aria-hidden="true">
          <Icon />
        </span>
        <Text weight="semibold">{title}</Text>
      </div>
      <Text size={300} className={styles.message}>
        {message}
      </Text>
      {diagnosticId ? (
        <Text size={200} className={styles.diagnostic}>
          {`Diagnostic ID: ${diagnosticId}`}
        </Text>
      ) : null}
      <div className={styles.actions}>
        {primaryRecoveryAction}
        {secondaryAction}
      </div>
    </section>
  );
}
