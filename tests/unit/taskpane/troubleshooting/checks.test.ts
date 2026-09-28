import { describe, expect, it } from "vitest";
import {
  diagnoseSituation,
  troubleshootingCheckIds,
  type TroubleshootingInput,
} from "../../../../src/taskpane/troubleshooting/checks";

/** Everything switched on and nothing pending: the state with no blockers. */
function healthy(overrides: Partial<TroubleshootingInput> = {}): TroubleshootingInput {
  return {
    autoScan: true,
    trackedEditing: true,
    coverage: null,
    semanticProfileActive: true,
    providerConfigured: true,
    rawTextConsent: true,
    plannedCount: 0,
    reviewedCount: 0,
    ...overrides,
  };
}

describe("the troubleshooting registry", () => {
  it("says nothing is wrong when nothing is wrong", () => {
    // The page is somewhere people arrive *because* something is wrong. A list
    // of every symptom would leave the one that matters buried.
    expect(diagnoseSituation(healthy())).toEqual([]);
  });

  it("explains stale findings when auto-scan is off, and says the manual scan still works", () => {
    const notes = diagnoseSituation(healthy({ autoScan: false }));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe("auto-scan-off");
    expect(notes[0]?.remedy).toMatch(/re-scan now/i);
  });

  it("explains a refused Apply through tracked editing rather than the plan", () => {
    const notes = diagnoseSituation(healthy({ trackedEditing: false }));
    expect(notes[0]?.id).toBe("tracked-editing-off");
  });

  it("calls a partial analysis an unknown subset rather than a shorter list", () => {
    // The distinction matters: "fewer findings" invites the reading that the
    // rest of the document is clean, which is exactly the wrong conclusion.
    const notes = diagnoseSituation(healthy({ coverage: { complete: false } as never }));
    expect(notes[0]?.id).toBe("coverage-incomplete");
    expect(notes[0]?.cause).toMatch(/unknown subset/i);
  });

  it("reports every situation that is actually true, not just the first", () => {
    // Two independent problems need two answers. Stopping at the first would
    // leave the user fixing one and still stuck.
    const notes = diagnoseSituation(
      healthy({
        autoScan: false,
        trackedEditing: false,
        coverage: { complete: false } as never,
      }),
    );
    expect(notes.map((note) => note.id)).toEqual([
      "auto-scan-off",
      "tracked-editing-off",
      "coverage-incomplete",
    ]);
  });

  it("explains an Apply that is unavailable because nothing has been reviewed", () => {
    /*
     * Apply writes only reviewed findings, so a plan full of unreviewed
     * changes is a refusal the user cannot reason about from the button
     * alone — the button just looks broken.
     */
    const notes = diagnoseSituation(healthy({ plannedCount: 3, reviewedCount: 0 }));
    expect(notes[0]?.id).toBe("nothing-reviewed");
    // The count is read from the state, never hard-coded in the prose.
    expect(notes[0]?.cause).toContain("3 changes are waiting");
  });

  it("does not report the review blocker once something has been reviewed", () => {
    const notes = diagnoseSituation(healthy({ plannedCount: 3, reviewedCount: 1 }));
    expect(notes.map((note) => note.id)).not.toContain("nothing-reviewed");
  });

  it("gives the singular form for one waiting change", () => {
    // Grammatically nicer, but the real reason is that a shared string would
    // say "1 changes" and read as machine output.
    const notes = diagnoseSituation(healthy({ plannedCount: 1, reviewedCount: 0 }));
    expect(notes[0]?.cause).toContain("One change is waiting");
  });

  it("does not report the review blocker when there is nothing planned", () => {
    const notes = diagnoseSituation(healthy({ plannedCount: 0, reviewedCount: 0 }));
    expect(notes.map((note) => note.id)).not.toContain("nothing-reviewed");
  });

  it("reports a missing semantic profile, which also greys out the ribbon button", () => {
    const notes = diagnoseSituation(healthy({ semanticProfileActive: false }));
    expect(notes[0]?.id).toBe("no-semantic-profile");
  });

  it("reports a missing provider without implying the rest of the product is broken", () => {
    // The deterministic checks and the whole review gate still work. A note
    // that implied otherwise would push someone to switch a provider on to fix
    // a problem they do not have.
    const notes = diagnoseSituation(healthy({ providerConfigured: false }));
    expect(notes[0]?.id).toBe("no-provider");
    expect(notes[0]?.cause).toMatch(/deterministic checks.*still work/i);
  });

  it("reports a withdrawn raw-text consent once everything else is ready", () => {
    // The blocker the user cannot see: both prerequisites are true, so the only
    // explanation on offer is the provider or the profile, and both are
    // already configured.
    const notes = diagnoseSituation(healthy({ rawTextConsent: false }));
    expect(notes[0]?.id).toBe("no-raw-text-consent");
    expect(notes[0]?.cause).toMatch(/switched off/i);
  });

  it("does not blame consent when a provider or a profile is missing too", () => {
    // Naming the consent first would send someone to Settings for a toggle
    // that will not unblock them while there is nothing to send to.
    expect(
      diagnoseSituation(healthy({ rawTextConsent: false, providerConfigured: false })).map(
        (note) => note.id,
      ),
    ).not.toContain("no-raw-text-consent");
    expect(
      diagnoseSituation(healthy({ rawTextConsent: false, semanticProfileActive: false })).map(
        (note) => note.id,
      ),
    ).not.toContain("no-raw-text-consent");
  });

  it("names the exact control behind every remedy", () => {
    /*
     * The point of the registry. "Check your settings" is the non-answer the
     * panel was already giving; a path down to the labelled control is the
     * difference between advice and a step.
     */
    const notes = diagnoseSituation(
      healthy({
        autoScan: false,
        trackedEditing: false,
        semanticProfileActive: false,
        providerConfigured: false,
        rawTextConsent: false,
        plannedCount: 2,
        reviewedCount: 0,
        coverage: { complete: false } as never,
      }),
    );
    expect(notes).toHaveLength(6);
    notes.forEach((note) => {
      expect(note.remedyTarget.label.length).toBeGreaterThan(0);
      // Every label names a page and a control, not just a page.
      expect(note.remedyTarget.label).toMatch(/→/);
    });
    expect(notes.map((note) => note.remedyTarget.label)).toEqual([
      "Settings → Scanning → Scan automatically as the document changes",
      "Settings → Tracked editing → Allow ToneForge to apply tracked changes",
      "Document Governance → Findings → Review on each finding you want applied",
      "Semantic → Semantic profiles → Create empty profile",
      "Settings → Provider and privacy → Provider, then enter the key",
      "Troubleshooting → Analysis coverage diagnostics",
    ]);
  });

  it("keeps every registered id reachable, so a check cannot be added unreachable", () => {
    // Guards the registry against an entry whose predicate can never be true,
    // which would sit in the source as an answer to nothing.
    expect(troubleshootingCheckIds()).toEqual([
      "auto-scan-off",
      "tracked-editing-off",
      "nothing-reviewed",
      "no-semantic-profile",
      "no-provider",
      "no-raw-text-consent",
      "coverage-incomplete",
    ]);
  });

  it("gives every note a distinct id so two blockers cannot collapse into one row", () => {
    const notes = diagnoseSituation(
      healthy({
        autoScan: false,
        trackedEditing: false,
        semanticProfileActive: false,
        providerConfigured: false,
        plannedCount: 2,
        reviewedCount: 0,
      }),
    );
    expect(new Set(notes.map((note) => note.id)).size).toBe(notes.length);
  });
});
