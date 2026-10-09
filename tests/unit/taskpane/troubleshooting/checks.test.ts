import { describe, expect, it } from "vitest";
import {
  diagnoseSituation,
  troubleshootingCheckIds,
  type TroubleshootingInput,
} from "../../../../src/taskpane/troubleshooting/checks";
import { MAX_REVIEW_SELECTION_CHARS } from "../../../../src/taskpane/semantic/gates";

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
    // A selection in hand, a complete run with a model behind it, and a host
    // with the context-menu API and ranged replacement. `null` where a value is
    // marked below would mean "not established", which is its own case and is
    // exercised separately.
    semanticSelectionCaptured: true,
    semanticSelectionChars: 240,
    semanticPreservationRefused: false,
    consistency: {
      usedModel: true,
      complete: true,
      limitations: [],
      unresolved: 0,
      decisionParseFailed: false,
    },
    decisionRoleConfigured: true,
    decisionFallbackPolicy: "unresolved",
    contextMenuApi: true,
    rangedReplacementSupported: true,
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
        semanticSelectionChars: 41_000,
        semanticPreservationRefused: true,
        consistency: {
          usedModel: false,
          complete: true,
          limitations: [],
          unresolved: 0,
          decisionParseFailed: false,
        },
        contextMenuApi: false,
        rangedReplacementSupported: false,
      }),
    );
    expect(notes).toHaveLength(12);
    notes.forEach((note) => {
      expect(note.remedyTarget.label.length).toBeGreaterThan(0);
      // Every label names a page and a control, not just a page.
      expect(note.remedyTarget.label).toMatch(/→/);
    });
    expect(notes.map((note) => note.remedyTarget.label)).toEqual([
      "Settings → Scanning → Scan automatically as the document changes",
      "Settings → Tracked editing → Allow ToneForge to apply tracked changes",
      "Deterministic Review → Findings → Review on each finding you want applied",
      "Semantic Style → Semantic profiles → Create empty profile",
      "Settings → Provider and privacy → Provider, then enter the key",
      "Troubleshooting → Analysis coverage diagnostics",
      "Semantic Review → Use current selection",
      "Semantic Review → Use current selection, then narrow the selection in Word",
      "Semantic Review → Regenerate review",
      "Settings → Provider and privacy → Provider, then enter the key",
      "Add-ins ribbon → Deterministic Review group",
      "Semantic Review → Use current selection, then select the whole paragraph in Word",
    ]);
  });

  it("explains a review that cannot run because nothing was ever read", () => {
    /*
     * The button is disabled for this reason alone and says nothing about it.
     * Without the note, the user has three settings to check that are all fine.
     */
    const notes = diagnoseSituation(healthy({ semanticSelectionCaptured: false }));
    expect(notes[0]?.id).toBe("semantic-review-has-no-selection");
    expect(notes[0]?.remedyTarget.label).toBe("Semantic Review → Use current selection");
  });

  it("does not blame an unread selection when the page was never opened", () => {
    // `null` is "not established". Reporting a blocker on the strength of the
    // user never having visited a page would put a fault on a pane that has none.
    const notes = diagnoseSituation(healthy({ semanticSelectionCaptured: null }));
    expect(notes.map((note) => note.id)).not.toContain("semantic-review-has-no-selection");
  });

  /*
   * The three situations the semantic review introduced, none of which had a
   * check when the split shipped. Each is a refusal the user sees as a greyed-out
   * button, and each has a cause that no setting in ToneForge changes — so
   * without a note the panel's advice is actively wrong.
   */

  it("explains a selection that is too long, with both numbers", () => {
    // The gate refuses above the cap rather than truncating. A note that said
    // only "too long" would send the user to check their selection with no way
    // to judge how much of it to cut, and the cap is the one number that
    // matters.
    const notes = diagnoseSituation(
      healthy({ semanticSelectionCaptured: true, semanticSelectionChars: 41_000 }),
    );
    expect(notes[0]?.id).toBe("semantic-selection-too-long");
    expect(notes[0]?.cause).toContain("41,000");
    expect(notes[0]?.cause).toContain(MAX_REVIEW_SELECTION_CHARS.toLocaleString());
    expect(notes[0]?.remedyTarget.label).toBe(
      "Semantic Review → Use current selection, then narrow the selection in Word",
    );
  });

  it("says nothing about length when the cap is not exceeded", () => {
    // Exactly at the cap is allowed. An off-by-one here would refuse the
    // boundary the gate permits.
    const notes = diagnoseSituation(
      healthy({ semanticSelectionChars: MAX_REVIEW_SELECTION_CHARS }),
    );
    expect(notes.map((note) => note.id)).not.toContain("semantic-selection-too-long");
  });

  it("says nothing about length when no selection has been read", () => {
    // There is no length to report. The no-selection check already covers this
    // state, and a second note would be a second answer to one question.
    const notes = diagnoseSituation(
      healthy({ semanticSelectionCaptured: false, semanticSelectionChars: null }),
    );
    expect(notes.map((note) => note.id)).toEqual(["semantic-review-has-no-selection"]);
  });

  it("explains a revision the local check refused, and does not blame a setting", () => {
    const notes = diagnoseSituation(healthy({ semanticPreservationRefused: true }));
    expect(notes[0]?.id).toBe("semantic-preservation-refused");
    // The protection is not a preference. Telling the user to turn it off would
    // be advice the product cannot follow.
    expect(notes[0]?.remedy).toMatch(/cannot be switched off/i);
    expect(notes[0]?.remedyTarget.label).toBe("Semantic Review → Regenerate review");
  });

  it("explains a host that cannot write part of a paragraph, as a host limit", () => {
    const notes = diagnoseSituation(healthy({ rangedReplacementSupported: false }));
    expect(notes[0]?.id).toBe("semantic-ranged-replace-unsupported");
    // The whole-paragraph path is the same host's working path, so the note has
    // to say that or the user will conclude the feature is broken.
    expect(notes[0]?.cause).toMatch(/whole paragraph/i);
    expect(notes[0]?.remedyTarget.label).toBe(
      "Semantic Review → Use current selection, then select the whole paragraph in Word",
    );
  });

  it("says nothing about ranged replacement before the probe has run", () => {
    // `null` is "not established". Claiming the host lacks it on the strength of
    // not having looked is the failure ADR-0084 is about.
    const notes = diagnoseSituation(healthy({ rangedReplacementSupported: null }));
    expect(notes.map((note) => note.id)).not.toContain("semantic-ranged-replace-unsupported");
  });

  it("keeps the three semantic refusals apart from each other", () => {
    // All three are true in a plausible session: a long selection on a host
    // without ranged replacement, on a revision the local check refused. They
    // have three different causes and only the right combination of remedies
    // gets the user moving, so collapsing them into one note would be wrong in
    // the way that matters most.
    const notes = diagnoseSituation(
      healthy({
        semanticSelectionCaptured: true,
        semanticSelectionChars: 41_000,
        semanticPreservationRefused: true,
        rangedReplacementSupported: false,
      }),
    );
    const ids = notes.map((note) => note.id);
    expect(ids).toContain("semantic-selection-too-long");
    expect(ids).toContain("semantic-preservation-refused");
    expect(ids).toContain("semantic-ranged-replace-unsupported");
    expect(ids).not.toContain("semantic-review-has-no-selection");
  });

  it("distinguishes a consistency run with no model from an incomplete one", () => {
    // Two different causes behind one situation, and the remedy differs: one is
    // a missing provider, the other is a bound on the engine that no setting
    // raises. Naming the provider for the second would send the user to a
    // setting that cannot change the answer.
    const noModel = diagnoseSituation(
      healthy({
        consistency: {
          usedModel: false,
          complete: true,
          limitations: [],
          unresolved: 0,
          decisionParseFailed: false,
        },
        providerConfigured: false,
      }),
    );
    // Selected by id: a missing provider is its own note and is reported first.
    const noModelNote = noModel.find((note) => note.id === "consistency-review-partial");
    expect(noModelNote?.remedyTarget.label).toBe(
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
          unresolved: 0,
          decisionParseFailed: false,
        },
      }),
    );
    expect(bounded[0]?.remedyTarget.label).toBe(
      "Consistency Review → Results → the coverage line above the findings",
    );
    // The engine's own count is quoted, not paraphrased or dropped.
    expect(bounded[0]?.cause).toContain("18,100");
  });

  it("does not send a fully configured user to a provider setting for a model-free run", () => {
    /*
     * `usedModel: false` is a fact about the run, not proof that a setting is
     * missing. With a provider configured and consent already granted there is
     * nothing in Settings to change, so the target is the run's own reported
     * limitation instead.
     */
    const notes = diagnoseSituation(
      healthy({
        consistency: {
          usedModel: false,
          complete: true,
          limitations: [],
          unresolved: 0,
          decisionParseFailed: false,
        },
      }),
    );
    expect(notes[0]?.id).toBe("consistency-review-partial");
    expect(notes[0]?.remedyTarget.label).toBe(
      "Consistency Review → Results → the coverage line above the findings",
    );
    expect(notes[0]?.remedy).not.toMatch(/configure a provider/i);
  });

  it("says nothing about a consistency review that has not run", () => {
    expect(diagnoseSituation(healthy({ consistency: null })).map((note) => note.id)).not.toContain(
      "consistency-review-partial",
    );
  });

  it("explains unresolved comparisons when no decision model is bound", () => {
    // The decision role is a separate binding. An unbound role with the default
    // `unresolved` policy leaves the residue unresolved, and the remedy is to
    // bind a model — not to change a provider that is already configured.
    const notes = diagnoseSituation(
      healthy({
        decisionRoleConfigured: false,
        consistency: {
          usedModel: true,
          complete: true,
          limitations: [],
          unresolved: 3,
          decisionParseFailed: false,
        },
      }),
    );
    const note = notes.find((n) => n.id === "decision-role-unbound");
    expect(note).toBeDefined();
    expect(note?.remedyTarget.label).toBe(
      "Settings → AI roles → Consistency decision → Connect a provider",
    );
    // The deterministic results are complete; the note must not imply otherwise.
    expect(note?.cause).toMatch(/deterministic results are complete/i);
  });

  it("distinguishes the general-model fallback from an unbound role", () => {
    // Same unresolved count, different cause: the fallback reused the general
    // model, which was not prompted for adjudication. Collapsing the two would
    // name the wrong situation.
    const notes = diagnoseSituation(
      healthy({
        decisionRoleConfigured: false,
        decisionFallbackPolicy: "general_model",
        consistency: {
          usedModel: true,
          complete: true,
          limitations: [],
          unresolved: 3,
          decisionParseFailed: false,
        },
      }),
    );
    expect(notes.map((n) => n.id)).toContain("decision-fallback-general");
    expect(notes.map((n) => n.id)).not.toContain("decision-role-unbound");
  });

  it("says nothing about the decision role when the run left nothing unresolved", () => {
    // An unbound decision role is only a situation when there was residue to
    // adjudicate. A run that settled everything deterministically is not
    // blocked by the missing binding.
    const notes = diagnoseSituation(
      healthy({
        decisionRoleConfigured: false,
        consistency: {
          usedModel: true,
          complete: true,
          limitations: [],
          unresolved: 0,
          decisionParseFailed: false,
        },
      }),
    );
    expect(notes.map((n) => n.id)).not.toContain("decision-role-unbound");
    expect(notes.map((n) => n.id)).not.toContain("decision-fallback-general");
  });

  it("reports only the parse failure when an unbound role also failed to parse", () => {
    // A parse failure is the situation, not the missing binding: the model was
    // asked and its answer could not be read, so blaming the binding would name
    // the wrong cause and send the user to the wrong control.
    const notes = diagnoseSituation(
      healthy({
        decisionRoleConfigured: false,
        consistency: {
          usedModel: true,
          complete: true,
          limitations: [],
          unresolved: 3,
          decisionParseFailed: true,
        },
      }),
    );
    expect(notes.map((n) => n.id)).toContain("decision-parse-failed");
    expect(notes.map((n) => n.id)).not.toContain("decision-role-unbound");
    expect(notes.map((n) => n.id)).not.toContain("decision-fallback-general");
  });

  it("reports an unreadable decision response as a parse failure, not a missing model", () => {
    // The role is bound and the model answered; it just did not answer in JSON.
    // The remedy is a different model or a retry, not a connection.
    const notes = diagnoseSituation(
      healthy({
        consistency: {
          usedModel: true,
          complete: true,
          limitations: [],
          unresolved: 3,
          decisionParseFailed: true,
        },
      }),
    );
    const note = notes.find((n) => n.id === "decision-parse-failed");
    expect(note).toBeDefined();
    expect(note?.remedyTarget.label).toBe("Settings → AI roles → Consistency decision → Model");
    expect(note?.cause).toMatch(/not valid JSON/i);
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
    // The probe establishes that one API is unavailable, not what happened to
    // the manifest entries, so the note reports only the former.
    expect(notes[0]?.cause).toMatch(/Office\.contextMenu\.requestUpdate/);
    expect(notes[0]?.cause).not.toMatch(/manifest/i);
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
      "semantic-review-has-no-selection",
      "semantic-selection-too-long",
      "semantic-preservation-refused",
      "consistency-review-partial",
      "decision-role-unbound",
      "decision-fallback-general",
      "decision-parse-failed",
      "context-menu-api-absent",
      "semantic-ranged-replace-unsupported",
    ]);
  });

  it("produces every registered id from some input, so none is dead", () => {
    /*
     * The reachability check the order test's comment claims and does not make.
     * A check whose `appliesTo` can never be true is invisible: it costs nothing,
     * breaks nothing, and reports a situation that cannot occur — which is the
     * worst kind of dead code in a registry whose whole job is to be complete.
     *
     * Three inputs, because the semantic checks are mutually exclusive by
     * construction: one turns on everything that is not about the semantic
     * prerequisites, one is missing the profile *and* the provider, and one has
     * both and has withdrawn consent \u2014 which is the only state
     * `no-raw-text-consent` can be true in, and the reason it is written the way
     * it is. Writing only the first two made this test report that check as
     * unreachable, which is the test doing its job on itself.
     */
    const all = diagnoseSituation(
      healthy({
        autoScan: false,
        trackedEditing: false,
        plannedCount: 2,
        reviewedCount: 0,
        coverage: { complete: false } as never,
        semanticSelectionCaptured: false,
        semanticSelectionChars: 41_000,
        semanticPreservationRefused: true,
        consistency: {
          usedModel: false,
          complete: true,
          limitations: [],
          unresolved: 0,
          decisionParseFailed: false,
        },
        contextMenuApi: false,
        rangedReplacementSupported: false,
      }),
    );
    const noProfile = diagnoseSituation(
      healthy({ semanticProfileActive: false, providerConfigured: false, rawTextConsent: false }),
    );
    const consentWithdrawn = diagnoseSituation(healthy({ rawTextConsent: false }));
    // The decision checks are mutually exclusive by construction: an unbound
    // role with the `unresolved` policy, the same role with the `general_model`
    // policy, and a parse failure with the role bound. One input cannot reach
    // all three, so each gets its own.
    const decisionUnbound = diagnoseSituation(
      healthy({
        decisionRoleConfigured: false,
        consistency: {
          usedModel: true,
          complete: true,
          limitations: [],
          unresolved: 3,
          decisionParseFailed: false,
        },
      }),
    );
    const decisionFallback = diagnoseSituation(
      healthy({
        decisionRoleConfigured: false,
        decisionFallbackPolicy: "general_model",
        consistency: {
          usedModel: true,
          complete: true,
          limitations: [],
          unresolved: 3,
          decisionParseFailed: false,
        },
      }),
    );
    const decisionParseFailed = diagnoseSituation(
      healthy({
        consistency: {
          usedModel: true,
          complete: true,
          limitations: [],
          unresolved: 3,
          decisionParseFailed: true,
        },
      }),
    );
    const reached = new Set(
      [
        ...all,
        ...noProfile,
        ...consentWithdrawn,
        ...decisionUnbound,
        ...decisionFallback,
        ...decisionParseFailed,
      ].map((note) => note.id),
    );

    expect([...troubleshootingCheckIds()].filter((id) => !reached.has(id))).toEqual([]);
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
