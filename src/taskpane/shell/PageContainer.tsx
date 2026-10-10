import React from "react";
import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    width: "100%",
    boxSizing: "border-box",
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalL}`,
  },
});

export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * The page gutter.
 *
 * Every page renders inside one of these, so the horizontal padding, the
 * vertical rhythm between sections, and the full-width box are decided once
 * rather than per page (spec §2, §5). It replaces the `.tf-card` wrapper each
 * page styled by hand.
 *
 * It is a plain `<div>`, not a `<main>`: the shell owns the single `<main>`
 * landmark, and a page that rendered its own would nest two. Extra attributes
 * (`data-page`, `aria-*`) pass straight through, which is how a page keeps the
 * hooks its tests and the arrival mapping rely on.
 */
export function PageContainer({
  children,
  className,
  ...rest
}: PageContainerProps): React.ReactNode {
  const styles = useStyles();
  return (
    <div className={mergeClasses(styles.root, className)} {...rest}>
      {children}
    </div>
  );
}
