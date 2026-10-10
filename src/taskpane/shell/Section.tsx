import React from "react";
import { makeStyles, mergeClasses, Text, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  header: {
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
  action: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
});

export interface SectionProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string | undefined;
}

/**
 * The shared section (spec §27).
 *
 * A titled region with a consistent vertical rhythm, so pages stop using
 * arbitrary horizontal rules as their layout system. The heading is an `<h2>`,
 * one level below the page header's `<h1>`, and the header row is omitted
 * entirely when there is nothing to put in it.
 */
export function Section({
  title,
  description,
  action,
  children,
  className,
}: SectionProps): React.ReactNode {
  const styles = useStyles();
  const hasHeader = Boolean(title) || Boolean(description) || Boolean(action);
  return (
    <section className={mergeClasses(styles.root, className)}>
      {hasHeader ? (
        <div className={styles.header}>
          <div className={styles.heading}>
            {title ? (
              <Text as="h2" size={400} weight="semibold" block>
                {title}
              </Text>
            ) : null}
            {description ? (
              <Text size={300} block className={styles.description}>
                {description}
              </Text>
            ) : null}
          </div>
          {action ? <div className={styles.action}>{action}</div> : null}
        </div>
      ) : null}
      <div className={styles.body}>{children}</div>
    </section>
  );
}
