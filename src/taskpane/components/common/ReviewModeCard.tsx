import React from "react";
import {
  Button,
  Card,
  CardFooter,
  CardHeader,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { toneForgeIcons, type ToneForgeIconName } from "../../theme/icons";
import { ToneBadge, type StatusTone } from "./StatusBadge";

const useStyles = makeStyles({
  root: {
    width: "100%",
    boxSizing: "border-box",
  },
  header: {
    alignItems: "flex-start",
  },
  icon: {
    color: tokens.colorBrandForeground1,
    display: "flex",
    alignItems: "center",
  },
  description: {
    color: tokens.colorNeutralForeground2,
  },
  metadata: {
    color: tokens.colorNeutralForeground3,
  },
  footer: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalS,
  },
});

export interface ReviewModeCardProps {
  /** The review mode this card launches, used as the accessible name. */
  mode: string;
  title: string;
  description: string;
  icon: ToneForgeIconName;
  status: StatusTone;
  statusText: string;
  profileLabel?: string | undefined;
  metadata?: string | undefined;
  primaryAction: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string | undefined;
}

/**
 * One review mode on the Home command centre (spec §10). The card states the
 * mode, its current status, and the one primary action that moves it forward;
 * a secondary action is optional and never competes with the primary.
 */
export function ReviewModeCard({
  mode,
  title,
  description,
  icon,
  status,
  statusText,
  profileLabel,
  metadata,
  primaryAction,
  secondaryAction,
  className,
}: ReviewModeCardProps): React.ReactNode {
  const styles = useStyles();
  const Icon = toneForgeIcons[icon];
  return (
    <Card className={mergeClasses(styles.root, className)} aria-label={mode}>
      <CardHeader
        className={styles.header}
        image={
          <span className={styles.icon} aria-hidden="true">
            <Icon />
          </span>
        }
        header={<Text weight="semibold">{title}</Text>}
        description={
          <Text size={300} className={styles.description}>
            {description}
          </Text>
        }
        action={<ToneBadge tone={status} label={statusText} />}
      />
      {profileLabel ? (
        <Text size={200} className={styles.metadata}>
          {profileLabel}
        </Text>
      ) : null}
      {metadata ? (
        <Text size={200} className={styles.metadata}>
          {metadata}
        </Text>
      ) : null}
      <CardFooter className={styles.footer}>
        {primaryAction}
        {secondaryAction}
      </CardFooter>
    </Card>
  );
}

/** Re-exported so a caller can build a card action without a second import. */
export { Button as ReviewModeCardButton };
