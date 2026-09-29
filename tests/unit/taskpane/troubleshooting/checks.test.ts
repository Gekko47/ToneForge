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
    // A paragraph in hand, a complete run with a model behind it, and a host
    // with the context-menu API. `null` here would mean "not established", which
    // is its own case and is exercised separately below.
    semanticSelectionCaptured: true,
    consistency: { usedModel: true, complete: true, limitations: [] },
    contextMenuApi: true,
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
        semanticSelectionCaptured: false,
        consistency: { usedModel: false, complete: true, limitations: [] },
        contextMenuApi: false,
      }),
    );
    expect(notes).toHaveLength(9);
    notes.forEach((note) => {
      expect(note.remedyTarget.label.length).toBeGreaterThan(0);
      // Every label names a page and a control, not just a page.
      expect(note.remedyTarget.label).toMatch(/→/);
    });
    expect(notes.map((note) => note.remedyTarget.label)).toEqual([
      "Settings → Scanning → Scan automatically as the document changes",
      "Settings → Tracked editing → Allow ToneForge to apply tracked changes",
      "Deterministic Review → Findings → Review on each finding you want applied",
      "Semantic → Semantic profiles → Create empty profile",
      "Settings → Provider and privacy → Provider, then enter the key",
      "Troubleshooting → Analysis coverage diagnostics",
      "Semantic → Semantic rewrite → Read current selection",
      "Settings → Provider and privacy → Provider, then enter the key",
      "Add-ins ribbon → Deterministic Review group",
    ]);
  });

  it("explains a rewrite that cannot run because no paragraph was ever read", () => {
    /*
     * The button is disabled for this reason alone and says nothing about it.
     * Without the note, the user has three settings to check that are all fine.
     */
    const notes = diagnoseSituation(healthy({ semanticSelectionCaptured: false }));
    expect(notes[0]?.id).toBe("semantic-rewrite-has-no-paragraph");
    expect(notes[0]?.remedyTarget.label).toBe(
      "Semantic → Semantic rewrite → Read current selection",
    );
  });

  it("does not blame an unread paragraph when the Semantic tab was never opened", () => {
    // `null` is "not established". Reporting a blocker on the strength of the
    // user never having visited a tab would put a fault on a pane that has none.
    const notes = diagnoseSituation(healthy({ semanticSelectionCaptured: null }));
    expect(notes.map((note) => note.id)).not.toContain("semantic-rewrite-has-no-paragraph");
  });

  it("distinguishes a consistency run with no model from an incomplete one", () => {
    // Two different causes behind one situation, and the remedy differs: one is
    // a missing provider, the other is a bound on the engine that no setting
    // raises. Naming the provider for the second would send the user to a
    // setting that cannot change the answer.
    const noModel = diagnoseSituation(
      healthy({ consistency: { usedModel: false, complete: true, limitations: [] } }),
    );
    expect(noModel[0]?.id).toBe("consistency-review-partial");
    expect(noModel[0]?.remedyTarget.label).toBe(
      "Settings → Provider and privacy → Provider, then enter the key",
    );

    const bounded = diagnoseSituation(
      healthy({
        consistency: {
          usedModel: true,
          complete: false,
          limitations: [
            "Compared 200 statements in windows, so 18,100 pair comparisons were not made.",
          ],
        },
      }),
    );
    expect(bounded[0]?.remedyTarget.label).toBe(
      "Consistency Review → Results → the coverage line above the findings",
    );
    // The engine's own count is quoted, not paraphrased or dropped.
    expect(bounded[0]?.cause).toContain("18,100");
  });

  it("says nothing about a consistency review that has not run", () => {
    expect(diagnoseSituation(healthy({ consistency: null })).map((note) => note.id)).not.toContain(
      "consistency-review-partial",
    );
  });

  it("says nothing about the context menu before the probe has run", () => {
    // `null` is "not established". Claiming the menu is missing on the strength
    // of not having looked is the same defect as the probe reporting `false`
    // for a capability it never tested.
    expect(diagnoseSituation(healthy({ contextMenuApi: null }))).toEqual([]);
  });

  it("reports an absent context menu as a host limitation, not a setting", () => {
    const notes = diagnoseSituation(healthy({ contextMenuApi: false }));
    expect(notes[0]?.id).toBe("context-menu-api-absent");
    expect(notes[0]?.remedy).toMatch(/ribbon/i);
    // A note implying a missing menu is fixable inside the add-in sends the
    // user looking for a control that does not exist.
    expect(notes[0]?.remedy).toMatch(/no control in ToneForge turns the context menu on/i);
  });

  it("distinguishes the two absent API checks from each other", () => {
    // Both were `false` from one probe, and they have nothing to do with one
    // another: only the context-menu check may fire when the rewrite is fine.
    const notes = diagnoseSituation(
      healthy({ contextMenuApi: false, semanticSelectionCaptured: true }),
    );
    expect(notes.map((note) => note.id)).toEqual(["context-menu-api-absent"]);
  });

  it("keeps the registered ids in the order the panel reports them", () => {
    /*
     * This is an ORDER check, not a reachability check, and the title used to
     * claim the latter. Reachability is what the two tests above and below
     * establish: each of these ids is produced by some input, one id per
     * situation, across the whole file. Naming it accurately matters because a
     * title that promises more than the assertion delivers is how a genuinely
     * unreachable check would sail past this line.
     */
    expect(troubleshootingCheckIds()).toEqual([
      "auto-scan-off",
      "tracked-editing-off",
      "nothing-reviewed",
      "no-semantic-profile",
      "no-provider",
      "no-raw-text-consent",
      "coverage-incomplete",
      "semantic-rewrite-has-no-paragraph",
      "consistency-review-partial",
      "context-menu-api-absent",
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
