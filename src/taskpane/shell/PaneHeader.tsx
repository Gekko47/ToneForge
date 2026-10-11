import React from "react";
import {
  Badge,
  makeStyles,
  mergeClasses,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Text,
  tokens,
} from "@fluentui/react-components";
import {
  StatusBadge,
  type StatusTone,
  type ToneForgeStatus,
} from "../components/common/StatusBadge";
import type { PaneMarker } from "./headerMarkers";

/**
 * One marker line, in px. A label and a pill value share it, so the strip reads
 * as a single row of text rather than a row of boxes of differing heights.
 */
const MARKER_LINE = tokens.lineHeightBase300;

/**
 * The heading row's height, in px.
 *
 * The status pill is a Fluent `Badge` at `size="large"` — 24px, the smallest
 * size whose 16px icon is not cramped inside it — and the heading box is set to
 * the same height, so the pill and the title text share one line and one
 * centre. The `<h1>`'s own `margin: 0 0 var(--tf-space-3)` from the page ramp
 * is zeroed on the title: inside a flex row that margin is not breathing room,
 * it is a 12px offset that lifts the title and drops the pill.
 */
const HEADING_ROW = "24px";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  heading: {
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    /*
     * The row is exactly as tall as the status pill beside it. The pill is a
     * `Badge` at `size="large"` — 24px, the smallest size whose 16px icon is
     * not cramped — and the heading box matches it, so the pill and the title
     * text share one line and one centre rather than the pill hanging off the
     * title's line box.
     */
    height: HEADING_ROW,
  },
  titleText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    /*
     * The page ramp gives every `h1` `margin: 0 0 var(--tf-space-3)`. Inside a
     * flex row that is not breathing room — it is a 12px offset that lifts the
     * title off the pill's centre line. Zeroed here, the title's own 22px line
     * box is centred in the row's 24px, so the pill and the title text share
     * one baseline.
     */
    margin: 0,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
  },
  markers: {
    display: "flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalS,
    flexWrap: "wrap",
    /*
     * A `<dl>` is not inside anything that resets it, so the browser's own
     * `margin-block: 1em` and the `<dd>`'s `margin-inline-start: 40px` both
     * apply. Left alone they add 32px of dead space above and below the strip
     * and push every value 40px away from its label — the single largest
     * contributor to the header's height, and the reason the strip read as a
     * list rather than a row.
     */
    margin: 0,
    /*
     * The strip is a container for its own width, so the label-hiding rule
     * below can key off how much room the strip actually has rather than off
     * the viewport. A docked pane's strip is narrower than the window, so a
     * viewport query fires late and lets the strip wrap to three rows first.
     */
    containerType: "inline-size",
  },
  marker: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalXS,
    maxWidth: "100%",
    /* Only the value may shrink; the label keeps its own width. */
    minWidth: 0,
  },
  markerLabel: {
    color: tokens.colorNeutralForeground2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    margin: 0,
    lineHeight: MARKER_LINE,
    /*
     * The label is pinned to its own content width. It used to be capped at
     * 50% of the strip, which resolved against the strip's shrink-to-fit width
     * and so truncated a label by how much room its *own* value needed — the
     * narrower the value, the shorter the label. With the cap gone a label is
     * only ever truncated when the row genuinely runs out of space, and the
     * value beside it is the thing that gives way.
     */
    flexShrink: 0,
    /*
     * A narrow strip (spec §5.7). The marker labels are the first thing to go:
     * they are the only part of the strip that is not the value itself, and the
     * value keeps its `title`, so nothing is lost that was not already
     * repeated. The label stays in the DOM rather than being unmounted,
     * because a `<dl>` whose `<dt>` disappears is no longer a definition list
     * — the screen reader would read a bare run of values with nothing to
     * attach them to. Visually hidden is the same thing as absent to a sighted
     * reader and still present to an assistive one.
     *
     * The threshold is the strip's own width, not the viewport's: about 370px
     * is where a fully-loaded review strip stops fitting its labels and values
     * on one line and starts wrapping to a third row. Hiding the labels there
     * buys back the room the labels themselves were taking, so the strip
     * returns to fewer rows and every pill stays whole. The header grows to
     * whatever the strip needs — nothing is clipped.
     */
    "@container (max-width: 370px)": {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: 0,
      margin: "-1px",
      overflow: "hidden",
      clip: "rect(0, 0, 0, 0)",
      whiteSpace: "nowrap",
      border: 0,
    },
  },
  markerValue: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    margin: 0,
    lineHeight: MARKER_LINE,
    minWidth: 0,
  },
});

export interface PaneWarning {
  tone: "warning" | "danger";
  title: string;
  body: string;
  action?: React.ReactNode | undefined;
}

export interface PaneHeaderProps {
  /** The pane's one `<h1>`. Defaults to `routeLabel(destination)`. */
  title: string;
  /**
   * Status vocabulary label (spec §14). Rendered as a badge.
   *
   * The tone is deliberately not accepted here: [`StatusBadge`](../components/common/StatusBadge.tsx)
   * derives it from the label, so a caller passing a tone that disagreed with
   * the vocabulary would be silently overridden. One owner per mapping.
   */
  status?: { label: ToneForgeStatus; title?: string | undefined } | undefined;
  /** The dense marker strip. Rendered as a `<dl>` of Fluent Text plus markers. */
  markers?: readonly PaneMarker[] | undefined;
  /** Contextual actions, right-aligned on the title row. */
  actions?: React.ReactNode | undefined;
  /** Utility/workspace only: a single prominent warning, via Fluent MessageBar. */
  warning?: PaneWarning | null | undefined;
  /** Optional class name for the root element. */
  className?: string | undefined;
}

const TONE_COLOR: Record<StatusTone, "informative" | "success" | "warning" | "danger"> = {
  neutral: "informative",
  success: "success",
  warning: "warning",
  danger: "danger",
};

const WARNING_INTENT: Record<PaneWarning["tone"], "warning" | "error"> = {
  warning: "warning",
  danger: "error",
};

/**
 * The one header every pane renders (ADR-0138).
 *
 * It owns the pane's single h1 — the page title — and surfaces pane-specific
 * metadata and status markers in a consistent layout. The brand title that used
 * to occupy this space is removed; the product name lives in the native pane
 * title and the navigation drawer.
 *
 * The layout is a title row with optional status badge and actions, a marker
 * strip of labelled values, and an optional warning. No icons, no descriptions —
 * the header is as slim as possible while carrying the pane's key facts.
 *
 * Truncation (spec §5.6): the title and every marker value are one line with
 * an ellipsis, and each carries its full value in `title`, so a truncated value
 * is recoverable by hover. A marker label is never truncated while the row has
 * room for it — it is pinned to its own content width and the value beside it
 * is the thing that gives way. Below about 370px of strip width the labels hide
 * entirely, which buys back the room they were taking so the strip returns to
 * fewer rows and every pill stays whole; they stay in the DOM, because a `<dl>`
 * whose `<dt>` is unmounted is no longer a definition list. The strip is
 * content-sized — it is exactly as tall as the rows it needs, so a pane
 * carrying many markers grows the header rather than clipping a pill.
 *
 * Accessibility (spec §5.8): the warning is `role="note"`, never a live region.
 * The pane's one live region stays in [`AppShell`](./AppShell.tsx:42) (ADR-0062),
 * so a header warning cannot announce over a scan result.
 */
export function PaneHeader({
  title,
  status,
  markers,
  actions,
  warning,
  className,
}: PaneHeaderProps): React.ReactNode {
  const styles = useStyles();

  return (
    <header className={mergeClasses(styles.root, className)}>
      <div className={styles.row}>
        <div className={styles.heading}>
          <Text
            as="h1"
            size={400}
            weight="semibold"
            block
            className={styles.titleText}
            title={title}
          >
            {title}
          </Text>
        </div>
        {status ? <StatusBadge status={status.label} title={status.title} /> : null}
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      {markers !== undefined && markers.length > 0 ? (
        <dl className={styles.markers}>
          {markers.map((marker) => (
            <div key={marker.key} className={styles.marker}>
              {marker.label !== undefined ? (
                <dt className={styles.markerLabel}>{marker.label}</dt>
              ) : null}
              <dd className={styles.markerValue} title={marker.title}>
                {marker.tone !== undefined ? (
                  <Badge appearance="tint" color={TONE_COLOR[marker.tone]} shape="rounded">
                    {marker.value}
                  </Badge>
                ) : (
                  marker.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {warning ? (
        <MessageBar intent={WARNING_INTENT[warning.tone]} layout="multiline" role="note">
          <MessageBarBody>
            <MessageBarTitle>{warning.title}</MessageBarTitle>
            {warning.body}
          </MessageBarBody>
          {warning.action ? <MessageBarActions>{warning.action}</MessageBarActions> : null}
        </MessageBar>
      ) : null}
    </header>
  );
}
