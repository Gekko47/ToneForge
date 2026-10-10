import React from "react";
import { makeStyles, mergeClasses, Text, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  row: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  heading: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXXS,
    minWidth: 0,
  },
  description: {
    color: tokens.colorNeutralForeground2,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
});

export interface PageHeaderProps {
  title: string;
  description?: string;
  status?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string | undefined;
}

/**
 * The shared page header (spec §26).
 *
 * One title, one optional description, one optional status, one optional action
 * region — so no page repeats product branding or invents its own heading
 * treatment. The title is the page's `<h1>`; the application title is separate
 * and lives in the shell header, not here.
 */
export function PageHeader({
  title,
  description,
  status,
  actions,
  className,
}: PageHeaderProps): React.ReactNode {
  const styles = useStyles();
  return (
    <header className={mergeClasses(styles.root, className)}>
      <div className={styles.row}>
        <div className={styles.heading}>
          <Text as="h1" size={600} weight="semibold" block>
            {title}
          </Text>
          {description ? (
            <Text size={300} block className={styles.description}>
              {description}
            </Text>
          ) : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      {status ? <div>{status}</div> : null}
    </header>
  );
}
