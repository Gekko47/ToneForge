import React from "react";
import { Button, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { toneForgeIcons } from "../theme/icons";
import { routeLabel, type TaskPaneDestination } from "../routes";

const useStyles = makeStyles({
  root: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
  button: {
    padding: "6px",
  },
});

export interface BreadcrumbProps {
  /**
   * The page this control returns to, or `null` for the root.
   *
   * The label is derived from the parent's entry in `ROUTES`, so a breadcrumb
   * cannot say one thing and navigate somewhere else (ADR-0102, ADR-0137).
   */
  parent: TaskPaneDestination | null;
  onBack: () => void;
  className?: string | undefined;
}

/**
 * The shared back-navigation control (spec §26).
 *
 * Every secondary page used to repeat a `<nav aria-label="Breadcrumb">` with a
 * native back button. One component means the label, the icon and the accessible
 * name cannot drift between pages, and the control is a Fluent `Button` rather
 * than a bare `<button>` the stylesheet had to reach into.
 */
export function Breadcrumb({ parent, onBack, className }: BreadcrumbProps): React.ReactNode {
  const styles = useStyles();
  const BackIcon = toneForgeIcons.back;
  if (parent === null) return null;
  return (
    <nav aria-label="Breadcrumb" className={mergeClasses(styles.root, className)}>
      <Button appearance="subtle" icon={<BackIcon />} className={styles.button} onClick={onBack}>
        {`Back to ${routeLabel(parent)}`}
      </Button>
    </nav>
  );
}
