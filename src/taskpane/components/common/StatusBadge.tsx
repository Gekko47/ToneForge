import React from "react";
import { Badge } from "@fluentui/react-components";
import { toneForgeIcons } from "../../theme/icons";

/**
 * The single status vocabulary (spec §14). Every status chip in the pane
 * resolves to one of these labels, so the user learns the words once.
 */
export const STATUS_VOCABULARY = [
  "Ready",
  "Not checked",
  "In progress",
  "Needs review",
  "Approved",
  "Skipped",
  "Complete",
  "Incomplete",
  "Stale",
  "Unavailable",
  "Unsupported",
  "Error",
] as const;

export type ToneForgeStatus = (typeof STATUS_VOCABULARY)[number];

/** The four severity tones (spec §15). */
export type StatusTone = "neutral" | "success" | "warning" | "danger";

const STATUS_TONE: Readonly<Record<ToneForgeStatus, StatusTone>> = {
  Ready: "neutral",
  "Not checked": "neutral",
  "In progress": "neutral",
  "Needs review": "warning",
  Approved: "success",
  Skipped: "neutral",
  Complete: "success",
  Incomplete: "warning",
  Stale: "warning",
  Unavailable: "neutral",
  Unsupported: "neutral",
  Error: "danger",
};

const STATUS_TONE_COLOR: Readonly<
  Record<StatusTone, "informative" | "success" | "warning" | "danger">
> = {
  neutral: "informative",
  success: "success",
  warning: "warning",
  danger: "danger",
};

const STATUS_TONE_ICON: Readonly<Record<StatusTone, keyof typeof toneForgeIcons>> = {
  neutral: "info",
  success: "success",
  warning: "warning",
  danger: "error",
};

export function statusTone(status: ToneForgeStatus): StatusTone {
  return STATUS_TONE[status];
}

export interface StatusBadgeProps {
  status: ToneForgeStatus;
  className?: string | undefined;
}

/**
 * Maps a status label to its tone and renders the chip. The tone is the only
 * thing that decides colour and icon, so a status can never be colour-only
 * (spec §15).
 */
export function StatusBadge({ status, className }: StatusBadgeProps): React.ReactNode {
  const tone = statusTone(status);
  const Icon = toneForgeIcons[STATUS_TONE_ICON[tone]];
  return (
    <Badge
      className={className}
      appearance="tint"
      color={STATUS_TONE_COLOR[tone]}
      icon={<Icon />}
      shape="rounded"
    >
      {status}
    </Badge>
  );
}

export interface ToneBadgeProps {
  tone: StatusTone;
  label: string;
  /**
   * The hover tooltip. A status chip that summarises a longer reason — "Partly
   * checked" over a list of the standards the host cannot read — carries the
   * detail here rather than in the chip, which has to stay scannable.
   */
  title?: string | undefined;
  className?: string | undefined;
}

/** The primitive behind [`StatusBadge`], for callers that already hold a tone. */
export function ToneBadge({ tone, label, title, className }: ToneBadgeProps): React.ReactNode {
  const Icon = toneForgeIcons[STATUS_TONE_ICON[tone]];
  return (
    <Badge
      className={className}
      appearance="tint"
      color={STATUS_TONE_COLOR[tone]}
      icon={<Icon />}
      shape="rounded"
      title={title}
    >
      {label}
    </Badge>
  );
}
