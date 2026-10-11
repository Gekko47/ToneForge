import React from "react";
import { Button, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { TaskPaneDestination } from "../components/TaskPaneHeader";
import { ReviewModeCard } from "../components/common/ReviewModeCard";
import { Section } from "../shell/Section";
import { computeHomeCards, type HomeState } from "./homeState";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalL,
  },
  cards: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  attention: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    /* The remedy button drops below the sentence rather than pushing the row
       wider than the pane (spec §33). */
    flexWrap: "wrap",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  attentionText: {
    color: tokens.colorNeutralForeground2,
  },
  setupCard: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    /* The setup sentence is the longest text on Home; it wraps above the
       button at narrow widths instead of forcing a horizontal scroll. */
    flexWrap: "wrap",
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  setupText: {
    color: tokens.colorNeutralForeground2,
  },
  activeStyles: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
  },
  styleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    flexWrap: "wrap",
  },
  styleLabel: {
    color: tokens.colorNeutralForeground2,
    minWidth: "80px",
  },
  styleValue: {
    color: tokens.colorNeutralForeground1,
    fontWeight: 600,
    /* A long profile name wraps rather than overflowing the row. */
    minWidth: 0,
    overflowWrap: "anywhere",
  },
});

export interface HomeProps {
  /** The raw pane state, computed by the caller. */
  state: HomeState;
  onNavigate: (destination: TaskPaneDestination) => void;
}

/**
 * The Home command centre (spec §8–§13, plan §6).
 *
 * It reads existing state only — no Home-owned storage, no auto-start. Three
 * `ReviewModeCard`s present the review modes with their current status and the
 * one primary action that moves each forward. An active-styles section shows the
 * two profiles. An attention line surfaces staleness. An unobtrusive setup card
 * appears only when configuration is incomplete.
 *
 * The state mapping lives in [`homeState.ts`](./homeState.ts) so it is testable
 * without a host.
 */
export default function Home({ state, onNavigate }: HomeProps): React.ReactNode {
  const styles = useStyles();
  const cards = computeHomeCards(state);

  return (
    <div className={styles.root} data-page="home">
      <div className={styles.cards}>
        <ReviewModeCard
          mode="deterministic"
          title="Deterministic Review"
          description="Document standards & style"
          icon="deterministicReview"
          status={cards.deterministic.status}
          statusText={cards.deterministic.statusText}
          profileLabel={cards.deterministic.profileLabel}
          metadata={cards.deterministic.metadata}
          primaryAction={
            <Button
              as="button"
              appearance="primary"
              disabled={cards.deterministic.primaryAction.disabled}
              onClick={() => onNavigate("review")}
            >
              {cards.deterministic.primaryAction.label}
            </Button>
          }
        />
        <ReviewModeCard
          mode="semantic"
          title="Semantic Review"
          description="Review selected writing"
          icon="semanticReview"
          status={cards.semantic.status}
          statusText={cards.semantic.statusText}
          profileLabel={cards.semantic.profileLabel}
          metadata={cards.semantic.metadata}
          primaryAction={
            <Button
              as="button"
              appearance="primary"
              disabled={cards.semantic.primaryAction.disabled}
              onClick={() =>
                onNavigate(cards.semantic.primaryAction.destination ?? "semantic-review")
              }
            >
              {cards.semantic.primaryAction.label}
            </Button>
          }
        />
        <ReviewModeCard
          mode="consistency"
          title="Consistency Review"
          description="Cross-report consistency"
          icon="consistencyReview"
          status={cards.consistency.status}
          statusText={cards.consistency.statusText}
          metadata={cards.consistency.metadata}
          primaryAction={
            <Button
              as="button"
              appearance="primary"
              disabled={cards.consistency.primaryAction.disabled}
              onClick={() => onNavigate("consistency")}
            >
              {cards.consistency.primaryAction.label}
            </Button>
          }
        />
      </div>

      {cards.attention !== null && (
        <div className={styles.attention} role="status">
          <Text size={300} className={styles.attentionText}>
            {cards.attention}
          </Text>
          <Button
            as="button"
            appearance="outline"
            size="small"
            onClick={() => onNavigate("review")}
          >
            Run review again
          </Button>
        </div>
      )}

      <Section title="Active styles">
        <div className={styles.activeStyles}>
          <div className={styles.styleRow}>
            <Text size={300} className={styles.styleLabel}>
              Deterministic
            </Text>
            <Text size={300} className={styles.styleValue}>
              {state.activeDeterministicProfile !== null
                ? `${state.activeDeterministicProfile.name} r${state.activeDeterministicProfile.revision}`
                : "None"}
            </Text>
          </div>
          <div className={styles.styleRow}>
            <Text size={300} className={styles.styleLabel}>
              Semantic
            </Text>
            <Text size={300} className={styles.styleValue}>
              {state.activeSemanticProfile !== null
                ? `${state.activeSemanticProfile.name} r${state.activeSemanticProfile.revision}`
                : "None"}
            </Text>
          </div>
        </div>
      </Section>

      {!state.setup.complete && (
        <div className={styles.setupCard}>
          <Text size={300} className={styles.setupText}>
            AI provider is required for Semantic and Consistency Review. Deterministic Review is
            ready.
          </Text>
          <Button
            as="button"
            appearance="outline"
            size="small"
            onClick={() => onNavigate("llm-settings")}
          >
            Complete setup
          </Button>
        </div>
      )}
    </div>
  );
}
