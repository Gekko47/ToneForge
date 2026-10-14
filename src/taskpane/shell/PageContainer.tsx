import React from "react";
import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
    width: "100%",
    boxSizing: "border-box",
  },
});

export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * The page body (full-bleed).
 *
 * It owns only the vertical rhythm between a page's top-level elements; it adds
 * **no horizontal inset**. Every page rings edge-to-edge so the sticky bar and
 * each card reach the pane's own edge, and every surface owns its own padding
 * rather than stacking a shell gutter on top of it — the "double padding" that
 * inset every screen on all four sides. The sticky bar supplies the one inset a
 * full-bleed bar still needs ([`taskpane.css`](../taskpane.css:800)).
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
