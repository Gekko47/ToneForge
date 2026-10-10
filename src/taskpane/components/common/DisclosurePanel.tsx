import React from "react";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  makeStyles,
  mergeClasses,
} from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    width: "100%",
  },
});

export interface DisclosurePanelProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean | undefined;
  className?: string | undefined;
}

/**
 * The one disclosure (spec §32). Troubleshooting and other secondary detail
 * collapse behind a single accordion item so the primary surface stays short.
 */
export function DisclosurePanel({
  title,
  children,
  defaultOpen = false,
  className,
}: DisclosurePanelProps): React.ReactNode {
  const styles = useStyles();
  return (
    <Accordion
      className={mergeClasses(styles.root, className)}
      collapsible
      defaultOpenItems={defaultOpen ? "panel" : undefined}
    >
      <AccordionItem value="panel">
        <AccordionHeader>{title}</AccordionHeader>
        <AccordionPanel>{children}</AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
}
