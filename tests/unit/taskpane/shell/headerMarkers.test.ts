import { describe, expect, it } from "vitest";
import {
  consistencyHeaderMarkers,
  governanceHeaderMarkers,
  reviewHeaderMarkers,
  semanticReviewHeaderMarkers,
  settingsHeaderMarkers,
  styleHeaderMarkers,
  type ConsistencyHeaderInput,
  type GovernanceHeaderInput,
  type ReviewHeaderInput,
  type SemanticReviewHeaderInput,
  type SettingsHeaderInput,
  type StyleHeaderInput,
} from "../../../../src/taskpane/shell/headerMarkers";

/**
 * The review marker mapper (ADR-0138).
 *
 * Pure, so it is tested directly: no React, no Office, no LLM. What is asserted
 * is the contract the header relies on — which markers exist for which state,
 * and in what order — because the strip's height budget assumes a bounded
 * number of them.
 */

/** A healthy, fully-scanned document with one profile active. */
const HEALTHY: ReviewHeaderInput = {
  profileName: "Finance",
  profileRevision: 3,
  lastScan: "2026-10-10T16:04:00.000Z",
  examinedScopes: ["body", "headings"],
  phase: "fresh",
  stale: false,
  hostUnavailable: false,
  findingCount: 0,
  errorCount: 0,
  warningCount: 0,
  coverageComplete: true,
};

/** Nothing has happened yet: no scan, no profile, no host. */
const EMPTY: ReviewHeaderInput = {
  profileName: null,
  profileRevision: null,
  lastScan: null,
  examinedScopes: [],
  phase: "notStarted",
  stale: false,
  hostUnavailable: false,
  findingCount: 0,
  errorCount: 0,
  warningCount: 0,
  coverageComplete: false,
};

function keys(input: ReviewHeaderInput): string[] {
  return reviewHeaderMarkers(input).map((marker) => marker.key);
}

describe("reviewHeaderMarkers", () => {
  it("says nothing at all when nothing has been scanned", () => {
    expect(reviewHeaderMarkers(EMPTY)).toEqual([]);
  });

  it("names the last scan and the scope it examined, so the counts below are judgeable", () => {
    const markers = reviewHeaderMarkers(HEALTHY);
    const lastScan = markers.find((marker) => marker.key === "last-scan");
    const scope = markers.find((marker) => marker.key === "scope");

    expect(lastScan?.label).toBe("Last scan");
    expect(lastScan?.value).toMatch(/^\d{1,2}:\d{2}/);
    expect(scope?.label).toBe("Scope");
    expect(scope?.value).toBe("Body, Headings");
  });

  it("omits the last scan while a scan is running, because the time would be the previous run's", () => {
    const running = { ...HEALTHY, phase: "scanning" } as const;
    expect(keys(running)).not.toContain("last-scan");
    expect(keys(running)).toContain("scanning");
  });

  it("reports an unparseable timestamp as Unknown rather than as an invalid date", () => {
    const markers = reviewHeaderMarkers({ ...HEALTHY, lastScan: "not-a-timestamp" });
    expect(markers.find((marker) => marker.key === "last-scan")?.value).toBe("Unknown");
  });

  it("leads with the host error, because nothing below it can be trusted", () => {
    const markers = reviewHeaderMarkers({ ...HEALTHY, hostUnavailable: true });
    expect(markers[0]?.key).toBe("host");
    expect(markers[0]?.value).toBe("Unavailable");
  });

  it("leads with the scan error, and does not also call the document stale", () => {
    const failed = {
      ...HEALTHY,
      phase: "failed",
      stale: true,
      findingCount: 4,
    } as const;
    const markers = reviewHeaderMarkers(failed);
    expect(markers[0]?.key).toBe("scan-error");
    expect(keys(failed)).not.toContain("stale");
    expect(keys(failed)).not.toContain("findings");
  });

  it("counts findings, and carries the error and warning split in the title", () => {
    const markers = reviewHeaderMarkers({
      ...HEALTHY,
      findingCount: 4,
      errorCount: 2,
      warningCount: 2,
    });
    const findings = markers.find((marker) => marker.key === "findings");
    expect(findings?.value).toBe("4 findings");
    expect(findings?.tone).toBe("danger");
    expect(findings?.title).toBe("2 errors, 2 warnings");
  });

  it("uses the singular for one finding, and the plural for none", () => {
    expect(
      reviewHeaderMarkers({ ...HEALTHY, findingCount: 1 }).find((m) => m.key === "findings")?.value,
    ).toBe("1 finding");
    expect(reviewHeaderMarkers(HEALTHY).find((m) => m.key === "clean")?.value).toBe("No findings");
  });

  it("warns when a fresh scan did not cover the whole document", () => {
    const markers = reviewHeaderMarkers({ ...HEALTHY, coverageComplete: false });
    const coverage = markers.find((marker) => marker.key === "coverage");
    expect(coverage?.value).toBe("Partial");
    expect(coverage?.tone).toBe("warning");
  });

  it("names the active profile and its revision last, so the strip ends on identity", () => {
    const markers = reviewHeaderMarkers(HEALTHY);
    const profile = markers.at(-1);
    expect(profile?.key).toBe("profile");
    expect(profile?.value).toBe("Finance · r3");
  });

  it("stays within the strip's two-line budget for a fully-loaded review pane", () => {
    /*
     * The strip is capped at two lines in `PaneHeader`, so a marker that falls
     * off the end is unshown rather than unreachable. This asserts the mapper
     * does not routinely produce more markers than the strip can show: the
     * worst realistic case is host error, scan error, staleness, findings,
     * coverage, and profile.
     */
    const markers = reviewHeaderMarkers({
      ...HEALTHY,
      hostUnavailable: true,
      phase: "failed",
      stale: true,
      findingCount: 4,
      errorCount: 2,
      warningCount: 2,
      coverageComplete: false,
    });
    expect(markers.length).toBeLessThanOrEqual(6);
  });
});

describe("every marker carries a title, because the label hides below 370px", () => {
  /*
   * The marker strip's labels hide below 370px of strip width (ADR-0138). When
   * they are hidden, the tooltip is the only thing that says what the pill is
   * about. This guard asserts every marker produced by every mapper carries a
   * non-empty title, so a future marker cannot be added without one.
   */
  it("reviewHeaderMarkers: every marker in every branch", () => {
    const inputs: ReviewHeaderInput[] = [
      { ...HEALTHY, hostUnavailable: true },
      { ...HEALTHY, phase: "failed" },
      { ...HEALTHY, stale: true },
      { ...HEALTHY, phase: "scanning" },
      { ...HEALTHY, findingCount: 4, errorCount: 2, warningCount: 2 },
      { ...HEALTHY, findingCount: 2, errorCount: 0, warningCount: 2 },
      { ...HEALTHY, findingCount: 0 },
      { ...HEALTHY, coverageComplete: false },
      HEALTHY,
      { ...HEALTHY, profileRevision: null },
    ];

    for (const input of inputs) {
      for (const marker of reviewHeaderMarkers(input)) {
        expect(marker.title, `marker ${marker.key} should have a title`).toBeTruthy();
      }
    }
  });

  it("styleHeaderMarkers: every marker in every branch", () => {
    const inputs: StyleHeaderInput[] = [
      { profileName: "Tone", profileRevision: 1, hasDraft: true },
      { profileName: "Tone", profileRevision: null, hasDraft: true },
      { profileName: null, profileRevision: null, hasDraft: true },
      { profileName: "Tone", profileRevision: 1, hasDraft: false },
    ];

    for (const input of inputs) {
      for (const marker of styleHeaderMarkers(input)) {
        expect(marker.title, `marker ${marker.key} should have a title`).toBeTruthy();
      }
    }
  });

  it("semanticReviewHeaderMarkers: every marker in every branch", () => {
    const inputs: SemanticReviewHeaderInput[] = [
      { styleName: "Tone", styleRevision: 2, selectionChars: 500, providerConfigured: true },
      { styleName: null, styleRevision: null, selectionChars: 500, providerConfigured: true },
      { styleName: "Tone", styleRevision: null, selectionChars: 500, providerConfigured: true },
      { styleName: "Tone", styleRevision: 2, selectionChars: null, providerConfigured: true },
      { styleName: null, styleRevision: null, selectionChars: null, providerConfigured: false },
    ];

    for (const input of inputs) {
      for (const marker of semanticReviewHeaderMarkers(input)) {
        expect(marker.title, `marker ${marker.key} should have a title`).toBeTruthy();
      }
    }
  });

  it("consistencyHeaderMarkers: every marker in every branch", () => {
    const inputs: ConsistencyHeaderInput[] = [
      { ran: true, complete: true, providerConfigured: true },
      { ran: true, complete: false, providerConfigured: true },
      { ran: false, complete: false, providerConfigured: true },
      { ran: false, complete: false, providerConfigured: false },
    ];

    for (const input of inputs) {
      for (const marker of consistencyHeaderMarkers(input)) {
        expect(marker.title, `marker ${marker.key} should have a title`).toBeTruthy();
      }
    }
  });

  it("governanceHeaderMarkers: every marker in every branch", () => {
    const inputs: GovernanceHeaderInput[] = [
      { profileName: "Policy", policyRevision: 1, protectedRangeCount: 3 },
      { profileName: "Policy", policyRevision: null, protectedRangeCount: 1 },
      { profileName: null, policyRevision: null, protectedRangeCount: 0 },
    ];

    for (const input of inputs) {
      for (const marker of governanceHeaderMarkers(input)) {
        expect(marker.title, `marker ${marker.key} should have a title`).toBeTruthy();
      }
    }
  });

  it("settingsHeaderMarkers: every marker in every branch", () => {
    const inputs: SettingsHeaderInput[] = [
      { llmProviderConfigured: false, generalRoleConfigured: false },
      { llmProviderConfigured: false, generalRoleConfigured: true },
      { llmProviderConfigured: true, generalRoleConfigured: false },
      { llmProviderConfigured: true, generalRoleConfigured: true },
    ];

    for (const input of inputs) {
      for (const marker of settingsHeaderMarkers(input)) {
        expect(marker.title, `marker ${marker.key} should have a title`).toBeTruthy();
      }
    }
  });
});
