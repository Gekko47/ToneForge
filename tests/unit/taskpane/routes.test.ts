import { describe, expect, it } from "vitest";
import {
  HOME_ROUTE,
  PARENT_ROUTE,
  ROUTES,
  TASKPANE_DESTINATIONS,
  parentRoute,
  resolveParentDestination,
  routeLabel,
} from "../../../src/taskpane/routes";

/**
 * The parent map (ADR-0137).
 *
 * A breadcrumb's label is its destination, so the map has to be total and honest:
 * every destination must have an entry, every entry must name a real destination,
 * and the root must have none. The bug this guards is a breadcrumb that says one
 * page and lands on another, which is invisible unless the map is read against
 * the route list rather than assumed.
 */
describe("PARENT_ROUTE", () => {
  it("has an entry for every destination", () => {
    for (const destination of TASKPANE_DESTINATIONS) {
      expect(PARENT_ROUTE).toHaveProperty(destination.key);
    }
  });

  it("has no entry for a destination that does not exist", () => {
    expect(Object.keys(PARENT_ROUTE)).toHaveLength(TASKPANE_DESTINATIONS.length);
  });

  it("names only real destinations, and only as a parent", () => {
    const known = new Set(TASKPANE_DESTINATIONS.map((destination) => destination.key));
    for (const destination of TASKPANE_DESTINATIONS) {
      const parent = PARENT_ROUTE[destination.key];
      if (parent !== null) {
        expect(known).toContain(parent);
      }
    }
  });

  it("gives the root no parent", () => {
    expect(PARENT_ROUTE.landing).toBeNull();
  });

  it("never makes a page its own parent", () => {
    for (const destination of TASKPANE_DESTINATIONS) {
      expect(PARENT_ROUTE[destination.key]).not.toBe(destination.key);
    }
  });
});

describe("parentRoute", () => {
  it("returns the mapped parent for a grouped page", () => {
    expect(parentRoute("review")).toBe("landing");
    expect(parentRoute("profile")).toBe("review");
    expect(parentRoute("semantic-style")).toBe("semantic-review");
    expect(parentRoute("governance-policy")).toBe("landing");
  });

  it("returns null for the root", () => {
    expect(parentRoute("landing")).toBeNull();
  });
});

describe("resolveParentDestination", () => {
  it("returns the previous page for a settings page", () => {
    expect(resolveParentDestination("llm-settings", "governance-policy")).toBe("governance-policy");
    expect(resolveParentDestination("general-settings", "profile")).toBe("profile");
  });

  it("falls back to Home when the pane opened on a settings page", () => {
    expect(resolveParentDestination("llm-settings", null)).toBe("landing");
    expect(resolveParentDestination("general-settings", null)).toBe("landing");
  });

  it("returns to the previous page even when it is settings", () => {
    expect(resolveParentDestination("llm-settings", "general-settings")).toBe("general-settings");
  });

  it("ignores the previous page for every other destination", () => {
    expect(resolveParentDestination("review", "governance-policy")).toBe("landing");
    expect(resolveParentDestination("profile", "landing")).toBe("review");
    expect(resolveParentDestination("semantic-style", "landing")).toBe("semantic-review");
  });
});

describe("routeLabel", () => {
  it("returns the label a breadcrumb is derived from", () => {
    expect(routeLabel("landing")).toBe("Home");
    expect(routeLabel("review")).toBe("Deterministic Review");
    expect(routeLabel("semantic-review")).toBe("Semantic Review");
  });

  it("returns the same label ROUTES carries", () => {
    for (const route of ROUTES) {
      expect(routeLabel(route.key)).toBe(route.label);
    }
  });

  it("names the Home route the drawer uses", () => {
    expect(HOME_ROUTE.key).toBe("landing");
    expect(HOME_ROUTE.label).toBe("Home");
  });
});
