import React from "react";
import { Button, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { toneForgeIcons } from "../theme/icons";

const useStyles = makeStyles({
  root: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXS,
  },
});

export interface BreadcrumbProps {
  /** The back control's label, e.g. "Back to Deterministic Review". */
  label: string;
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
export function Breadcrumb({ label, onBack, className }: BreadcrumbProps): React.ReactNode {
  const styles = useStyles();
  const BackIcon = toneForgeIcons.back;
  return (
    <nav aria-label="Breadcrumb" className={mergeClasses(styles.root, className)}>
      <Button appearance="subtle" icon={<BackIcon />} onClick={onBack}>
        {label}
      </Button>
    </nav>
  );
}
