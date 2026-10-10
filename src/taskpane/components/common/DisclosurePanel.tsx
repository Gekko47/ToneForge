import React from "react";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    width: "100%",
  },
  headerContent: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalM,
    width: "100%",
  },
});

export interface DisclosurePanelProps {
  title: React.ReactNode;
  headerSlot?: React.ReactNode;
  ariaLabel?: string;
  id?: string;
  as?: "div" | "h2" | "h3" | "h4";
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
  children: React.ReactNode;
}

const ITEM = "panel";

/**
 * The one disclosure (spec §32). Troubleshooting and other secondary detail
 * collapse behind a single accordion item so the primary surface stays short.
 * Supports both controlled (open/onToggle) and uncontrolled (defaultOpen) usage.
 */
export function DisclosurePanel({
  title,
  headerSlot,
  ariaLabel,
  id,
  as = "div",
  defaultOpen = false,
  open,
  onToggle,
  className,
  children,
}: DisclosurePanelProps): React.ReactNode {
  const styles = useStyles();
  const controlled = open !== undefined;
  return (
    <Accordion
      className={mergeClasses(styles.root, className)}
      collapsible
      {...(controlled
        ? { openItems: open ? [ITEM] : [], onToggle: (_e, d) => onToggle?.(d.openItems.length > 0) }
        : { defaultOpenItems: defaultOpen ? [ITEM] : [] })}
    >
      <AccordionItem value={ITEM}>
        <AccordionHeader
          as={as}
          {...(id ? { id } : {})}
          {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
        >
          <span className={styles.headerContent}>
            {title}
            {headerSlot}
          </span>
        </AccordionHeader>
        <AccordionPanel>{children}</AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
}
