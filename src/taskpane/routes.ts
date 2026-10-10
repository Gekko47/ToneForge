import type { ToneForgeIconName } from "./theme/icons";

/**
 * The one source of truth for the pane's routes (ADR-0131).
 *
 * Each route owns its key, its user-facing label, the navigation group it
 * belongs to, and its icon. The drawer, the Home command centre, and any
 * breadcrumb read this list rather than repeating a label, so a rename is a
 * data change here and nowhere else.
 *
 * Route **keys** are deliberately stable — they are the values the ribbon
 * arrival mapping and the persisted page already use — so only the labels
 * change in the unified UX. A key rename would have to be mirrored in
 * `TaskpaneTarget` and its arrival mapping in the same change (ADR-0102).
 */
export type TaskPaneDestination =
  /** The landing page: the command centre. Reachable with no profile at all. */
  | "landing"
  /** Deterministic Review: findings, coverage, and pending changes. */
  | "review"
  | "consistency"
  | "profile"
  /**
   * Semantic Review: the review of a selection against a style.
   *
   * And `semantic-style` beside it, for the style itself. Two destinations, one
   * ribbon command (D10): the button opens Review, and Style is reached from
   * Review's own control or from this drawer. A second ribbon button would have
   * needed a second command claiming a navigation target, and
   * `duplicateNavigationTargets()` fails the build on exactly that.
   */
  | "semantic-review"
  | "semantic-style"
  | "governance-policy"
  /**
   * Two settings pages, because they answer two different questions.
   *
   * `llm-settings` is the provider and consent surface; `general-settings` is
   * the project-wide surface (scanning, tracked editing, styling). They were one
   * page until the LLM connector change replaced the composed Settings page with
   * the LLM dashboard and left the general sections unmounted; the split
   * restores them and names each page for what it holds.
   */
  | "llm-settings"
  | "general-settings"
  | "troubleshooting";

/** The navigation groups, in the order a user works in (spec §6.1). */
export type RouteGroup = "home" | "review" | "styles" | "more" | "settings";

export interface Route {
  key: TaskPaneDestination;
  label: string;
  group: RouteGroup;
  icon: ToneForgeIconName;
}

/**
 * The three review modes are primary; Styles is secondary; More is tertiary
 * (spec §6.1). Home is the root and is rendered on its own, above the groups.
 *
 * `settings` is the spec's `More → Settings` subgroup (§6). The drawer renders
 * flat groups, so it is a sibling of `more` rather than a nested list, but it
 * holds exactly the two pages the spec nests under Settings — LLM Settings and
 * General Settings — and nothing else.
 */
export const ROUTE_GROUPS: readonly { key: Exclude<RouteGroup, "home">; label: string }[] = [
  { key: "review", label: "Review" },
  { key: "styles", label: "Styles" },
  { key: "more", label: "More" },
  { key: "settings", label: "Settings" },
];

export const ROUTES: readonly Route[] = [
  { key: "landing", label: "Home", group: "home", icon: "home" },
  { key: "review", label: "Deterministic Review", group: "review", icon: "deterministicReview" },
  { key: "semantic-review", label: "Semantic Review", group: "review", icon: "semanticReview" },
  { key: "consistency", label: "Consistency Review", group: "review", icon: "consistencyReview" },
  { key: "profile", label: "Deterministic Style", group: "styles", icon: "styles" },
  { key: "semantic-style", label: "Semantic Style", group: "styles", icon: "styles" },
  { key: "governance-policy", label: "Governance", group: "more", icon: "governance" },
  { key: "troubleshooting", label: "Troubleshooting", group: "more", icon: "troubleshooting" },
  { key: "llm-settings", label: "LLM Settings", group: "settings", icon: "settings" },
  { key: "general-settings", label: "General Settings", group: "settings", icon: "settings" },
];

export const HOME_ROUTE: Route = ROUTES[0] as Route;

export interface NavGroup {
  key: Exclude<RouteGroup, "home">;
  label: string;
  routes: readonly Route[];
}

/** The grouped drawer, derived from `ROUTES` so a label cannot drift. */
export const NAV_GROUPS: readonly NavGroup[] = ROUTE_GROUPS.map((group) => ({
  ...group,
  routes: ROUTES.filter((route) => route.group === group.key),
}));

/**
 * Every destination, in drawer order.
 *
 * Exported so a routing test can enumerate destinations rather than repeat them.
 * The bug this exists to prevent: a destination was added to the drawer with no
 * branch in `DashboardWithoutProfile`, and every click on it fell through to
 * Home. A test listing destinations by name would have gone stale silently in
 * the same way the routing did; one that reads the list cannot.
 */
export const TASKPANE_DESTINATIONS: readonly {
  key: TaskPaneDestination;
  label: string;
}[] = ROUTES.map(({ key, label }) => ({ key, label }));
