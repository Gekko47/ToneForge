/**
 * FindingDetailOverlay — one finding at a time, in an overlay panel.
 *
 * Modelled on Word's Editor proofing view: a sticky header with close, the
 * remaining count and prev/next arrows together on the right; the finding body
 * beneath; and actions at the bottom.
 *
 * The overlay steps within the opened type group. `N remaining` counts that
 * group's undecided findings, matching the Editor's "5 remaining" under Spelling.
 *
 * Actions:
 * - Accept: applies that one change in the text immediately (tracked), then advances.
 * - Accept all of this type: applies every change in the group in one plan, then closes.
 * - Restore (ignored findings): moves the finding back to the live list.
 *
 * Skip and Ignore are not repeated here. They are per-finding decisions that
 * belong with the finding's own controls, and a second copy under Accept offered
 * the same action twice in one panel.
 */

import React from "react";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
} from "@fluentui/react-components";
import { Dismiss24Regular, ArrowLeft24Regular, ArrowRight24Regular } from "@fluentui/react-icons";
import type { Finding } from "../../core/domain/Finding";
import type { FindingTypeGroup } from "../findingsByType";
import FindingDetail from "./FindingDetail";

const DismissIcon = Dismiss24Regular;
const BackIcon = ArrowLeft24Regular;
const NextIcon = ArrowRight24Regular;

export interface FindingDetailOverlayProps {
  /** The type group being reviewed. */
  group: FindingTypeGroup | null;
  /** The finding currently shown within the group. */
  finding: Finding | null;
  /** How many findings in the group are still undecided. */
  remaining: number;
  /** Total findings in the group. */
  total: number;
  /** Current position within the group (1-based). */
  position: number;
  /** Whether Accept is disabled (e.g. coverage incomplete). */
  acceptDisabled: boolean;
  /** Why Accept is disabled, shown as a tooltip. */
  acceptDisabledReason?: string | null;
  /** Called when the overlay is closed. */
  onClose: () => void;
  /** Called when the previous finding is requested. */
  onPrevious: () => void;
  /** Called when the next finding is requested. */
  onNext: () => void;
  /** Accept: apply this one change and advance. */
  onAccept: (finding: Finding) => void;
  /** Accept all of this type: apply every change in the group and close. */
  onAcceptAll: (group: FindingTypeGroup) => void;
  /** Skip: advance without applying. Rendered inline by FindingDetail. */
  onSkip: (finding: Finding) => void;
  /** Ignore: move to the Ignored list and advance. Rendered inline by FindingDetail. */
  onIgnore: (finding: Finding) => void;
  /** Restore (ignored findings): move back to the live list. */
  onRestore?: (finding: Finding) => void;
  /** Whether this overlay is showing ignored findings (changes the action set). */
  isIgnored?: boolean;
  /**
   * The outcome of the last apply, when there is one.
   *
   * Accept is pressed here, so the result is rendered here. It used to render on
   * the main findings list behind the overlay — the user pressed Apply and the
   * confirmation sat on the page they could not see. It reports both success and
   * refusal, so a refused apply explains itself rather than reading as a silent
   * no-op.
   */
  applyNote?: string | null;
}

export default function FindingDetailOverlay({
  group,
  finding,
  remaining,
  total,
  position,
  acceptDisabled,
  acceptDisabledReason,
  onClose,
  onPrevious,
  onNext,
  onAccept,
  onAcceptAll,
  onSkip,
  onIgnore,
  onRestore,
  isIgnored = false,
  applyNote = null,
}: FindingDetailOverlayProps): React.ReactNode {
  const open = group !== null && finding !== null;
  const hasPrevious = position > 1;
  const hasNext = position < total;

  return (
    <Drawer
      open={open}
      type="overlay"
      position="end"
      size="medium"
      onOpenChange={(_, data) => {
        if (!data.open) onClose();
      }}
    >
      <DrawerHeader>
        <div className="tf-finding-overlay-header">
          <Button
            appearance="subtle"
            icon={<DismissIcon />}
            onClick={onClose}
            aria-label="Close finding review"
          />
          <DrawerHeaderTitle>
            <div className="tf-finding-overlay-header-title">{group?.ruleName ?? ""}</div>
          </DrawerHeaderTitle>
          {/*
            The count and the arrows are one unit on the right of the title: the
            count sits above the arrows, and the pair is stuck to the title's
            right edge. They answer the same question — where am I in this group —
            so they read as one thing rather than two.
          */}
          <div className="tf-finding-overlay-header-side">
            <span className="tf-finding-overlay-header-count" aria-live="polite">
              {remaining} remaining
            </span>
            <div className="tf-finding-overlay-header-nav">
              <Button
                appearance="subtle"
                icon={<BackIcon />}
                onClick={onPrevious}
                disabled={!hasPrevious}
                aria-label={`Previous finding, at ${position} of ${total}`}
              />
              <Button
                appearance="subtle"
                icon={<NextIcon />}
                onClick={onNext}
                disabled={!hasNext}
                aria-label={`Next finding, at ${position} of ${total}`}
              />
            </div>
          </div>
        </div>
      </DrawerHeader>
      <DrawerBody>
        <div className="tf-finding-overlay">
          <div className="tf-finding-overlay-body">
            {finding && (
              <FindingDetail
                finding={finding}
                variant="deterministic"
                onSkip={isIgnored ? undefined : onSkip}
                onIgnore={
                  isIgnored || !onIgnore
                    ? undefined
                    : (findingId: string) => {
                        void onIgnore({ ...finding, id: findingId });
                      }
                }
              />
            )}
            {/*
              The apply result, beside the action that produced it. Both outcomes
              are shown: a confirmed apply, and a refusal with its reason — which
              previously surfaced only in the console and on the findings page
              behind this overlay, so a refused Apply looked like a dead button.
            */}
            {applyNote !== null && (
              <p className="tf-finding-overlay-note" role="status" aria-live="polite">
                {applyNote}
              </p>
            )}
          </div>
          <div className="tf-finding-overlay-actions">
            {isIgnored ? (
              <Button appearance="primary" onClick={() => finding && onRestore?.(finding)}>
                Restore
              </Button>
            ) : (
              <>
                <Button
                  appearance="primary"
                  disabled={acceptDisabled}
                  title={acceptDisabledReason ?? undefined}
                  onClick={() => {
                    if (acceptDisabled) {
                      return;
                    }
                    if (finding) onAccept(finding);
                  }}
                >
                  Accept
                </Button>
                <Button
                  disabled={acceptDisabled}
                  title={acceptDisabledReason ?? undefined}
                  onClick={() => {
                    if (acceptDisabled) {
                      return;
                    }
                    if (group) onAcceptAll(group);
                  }}
                >
                  Accept all of this type
                </Button>
              </>
            )}
          </div>
        </div>
      </DrawerBody>
    </Drawer>
  );
}
