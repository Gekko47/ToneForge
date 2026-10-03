/**
 * Terminology survives a save/load round trip, and it survives on the *profile*.
 *
 * The relocation moved three vocabularies off the governance policy page and onto
 * the deterministic style profile. That is only a good move if the values the user
 * typed come back, and it is only honest if the governance record no longer carries
 * them — otherwise the wording is back in two places, and the two disagree the
 * moment one of them is edited.
 *
 * Both halves are asserted here. A test that only checked "the value persisted"
 * would still pass if the value had persisted in governance all along, which is
 * exactly the state the change was meant to end.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEmptyProfile } from "../../../../src/core/domain/index";
import { createRecord, newProfileId, updateDraft } from "../../../../src/core/domain/ProfileRecord";
import type { StyleProfile } from "../../../../src/core/domain/StyleProfile";
import {
  createGovernanceProfile,
  GovernanceProfileSchema,
} from "../../../../src/core/domain/GovernanceProfile";
import { loadState, saveProfileRecord } from "../../../../src/core/state/index";
import { findTerminologyIssues } from "../../../../src/rules/language";

const NOW = "2026-01-01T00:00:00.000Z";

const AUTHORED: StyleProfile["language"] = {
  ...createEmptyProfile("House", 1).language,
  terminology: [
    {
      id: "term-1",
      source: "colour",
      replacement: "color",
      caseSensitive: false,
      wholeWord: true,
      severity: "mandatory",
      scope: {},
    },
    {
      id: "term-2",
      source: "whilst",
      caseSensitive: true,
      wholeWord: true,
      severity: "advisory",
      scope: {},
    },
  ],
  bannedTerms: ["utilise", "leverage"],
  requiredTerms: [
    {
      id: "term-1",
      source: "house style",
      caseSensitive: false,
      wholeWord: true,
      severity: "mandatory",
      scope: {},
    },
  ],
};

function authoredProfile(): StyleProfile {
  return { ...createEmptyProfile("House", 1), language: AUTHORED };
}

/** The language section as it reads back out of storage. */
function storedLanguage(id: string): StyleProfile["language"] {
  const draft = loadState().profileRecords[id]?.draft;
  if (!draft) throw new Error("expected the record to have a persisted draft");
  return draft.language;
}

describe("terminology persistence", () => {
  let originalOffice: unknown;

  beforeEach(() => {
    originalOffice = (globalThis as { Office?: unknown }).Office;
    (globalThis as { Office?: unknown }).Office = undefined;
    window.localStorage.clear();
  });

  afterEach(() => {
    (globalThis as { Office?: unknown }).Office = originalOffice;
    window.localStorage.clear();
  });

  it("returns every authored term after a save and load", () => {
    const record = updateDraft(
      createRecord(newProfileId(), "House", NOW, authoredProfile()),
      authoredProfile(),
      NOW,
    ).record;
    saveProfileRecord(record);

    const stored = storedLanguage(record.id);
    expect(stored.terminology).toHaveLength(2);
    expect(stored.terminology[0]?.source).toBe("colour");
    expect(stored.terminology[0]?.replacement).toBe("color");
    expect(stored.terminology[0]?.severity).toBe("mandatory");
    expect(stored.terminology[1]?.source).toBe("whilst");
    expect(stored.bannedTerms).toEqual(["utilise", "leverage"]);
    expect(stored.requiredTerms).toHaveLength(1);
    expect(stored.requiredTerms[0]?.source).toBe("house style");
  });

  it("keeps a term's own flags rather than resetting them to the defaults", () => {
    const record = updateDraft(
      createRecord(newProfileId(), "Flags", NOW, authoredProfile()),
      authoredProfile(),
      NOW,
    ).record;
    saveProfileRecord(record);

    const stored = storedLanguage(record.id);
    // A round trip that lost `caseSensitive` would turn a deliberate
    // case-sensitive rule into one that fires on "Whilst" mid-sentence.
    expect(stored.terminology[1]?.caseSensitive).toBe(true);
    expect(stored.terminology[0]?.caseSensitive).toBe(false);
    expect(stored.terminology[0]?.wholeWord).toBe(true);
  });

  it("reads back through the rule, not just through the schema", () => {
    const record = updateDraft(
      createRecord(newProfileId(), "Rule", NOW, authoredProfile()),
      authoredProfile(),
      NOW,
    ).record;
    saveProfileRecord(record);

    const stored = storedLanguage(record.id);

    // The text misspells a preferred term ("colour" for "color"), uses a banned
    // term ("utilise"), and is missing the required term ("house style"). All
    // three must fire, which is the assertion that matters: a profile field that
    // persists but that no rule reads is indistinguishable from a working one at
    // the storage layer.
    const findings = findTerminologyIssues({
      text: "The colour scheme is fine. We could utilise the guidance.",
      rules: stored,
    });

    const categories = findings.map((finding) => finding.category);
    expect(categories).toContain("houseStyle.terminology");
    expect(categories).toContain("language.bannedTerm");
    expect(categories).toContain("language.terminology.missing");
  });

  it("no longer stores terminology on the governance record", () => {
    const profile = authoredProfile();
    const record = createRecord(newProfileId(), "Split", NOW, profile);
    saveProfileRecord(record);

    const governance = loadState().governanceProfiles[record.id];
    expect(governance).toBeDefined();
    expect(Object.keys(governance ?? {})).not.toContain("terminology");

    // Zod strips unknown keys rather than rejecting them, so the contract is
    // "carrying terminology is silently discarded", not "carrying it is an
    // error". Asserting the strip matters: it is what stops a stale record from
    // resurrecting a field the rest of the codebase can no longer read.
    const parsed = GovernanceProfileSchema.safeParse({ ...governance, terminology: { a: "b" } });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).not.toHaveProperty("terminology");
  });

  it("keeps governance protection settings working without a wording block", () => {
    const profile = authoredProfile();
    const record = createRecord(newProfileId(), "Protection", NOW, profile);
    const governance = createGovernanceProfile(profile);
    saveProfileRecord(record);

    expect(governance.protection).toBeDefined();
    expect(Object.keys(governance)).toContain("protection");
    expect(Object.keys(governance)).not.toContain("terminology");
  });
});
