import { describe, expect, it } from "vitest";
import { diffProfiles, formatChangelog } from "../../../src/style/versioning";
import { createEmptyProfile } from "../../../src/core/domain/StyleProfile";

describe("diffProfiles", () => {
  it("reports no changes when profiles are identical", () => {
    const profile = createEmptyProfile("Same");
    const diff = diffProfiles(profile, { ...profile });
    expect(diff.changedCount).toBe(0);
    expect(diff.changes).toHaveLength(0);
  });

  it("reports changed scalar fields", () => {
    const from = createEmptyProfile("Saved profile");
    const to = {
      ...from,
      name: "Edited profile",
      semantic: { ...from.semantic, tone: "conversational" },
    };
    const diff = diffProfiles(from, to);
    expect(diff.changedCount).toBe(2);
    const fields = diff.changes.map((c) => c.field);
    expect(fields).toContain("Profile name");
    expect(fields).toContain("Tone");
    const nameChange = diff.changes.find((c) => c.field === "Profile name");
    expect(nameChange?.from).toBe("Saved profile");
    expect(nameChange?.to).toBe("Edited profile");
  });

  it("reports array and record changes", () => {
    const from = createEmptyProfile("Saved profile");
    const to = {
      ...from,
      houseStyle: {
        ...from.houseStyle,
        bannedTerms: ["utilize"],
        preferredTerminology: { client: "customer" },
      },
    };
    const diff = diffProfiles(from, to);
    const fields = diff.changes.map((c) => c.field);
    expect(fields).toContain("Banned terms");
    expect(fields).toContain("Preferred terminology");
    const banned = diff.changes.find((c) => c.field === "Banned terms");
    expect(banned?.from).toBe("None");
    expect(banned?.to).toBe("utilize");
  });

  it("ignores measured metrics because they are derived", () => {
    const from = createEmptyProfile("Saved profile");
    const to = {
      ...from,
      measured: {
        ...from.measured,
        avgSentenceLength: 22,
        sampleWordCount: 500,
      },
    };
    const diff = diffProfiles(from, to);
    expect(diff.changedCount).toBe(0);
  });

  it("ignores the revision number because it is assigned, not authored", () => {
    const from = createEmptyProfile("Saved profile", 3);
    const to = { ...from, revision: 4 };
    const diff = diffProfiles(from, to);
    expect(diff.changedCount).toBe(0);
  });

  it("records the from and to revisions", () => {
    const from = createEmptyProfile("Saved", 3);
    const to = { ...from, revision: 4 };
    const diff = diffProfiles(from, to);
    expect(diff.fromRevision).toBe(3);
    expect(diff.toRevision).toBe(4);
  });
});

describe("formatChangelog", () => {
  it("returns a no-change message when nothing changed", () => {
    const profile = createEmptyProfile("Same", 2);
    const diff = diffProfiles(profile, { ...profile });
    expect(formatChangelog(diff)).toBe("No changes between revision 2 and revision 2.");
  });

  it("formats changed fields as a list", () => {
    const from = createEmptyProfile("Saved profile", 2);
    const to = { ...from, name: "Edited profile" };
    const diff = diffProfiles(from, to);
    const changelog = formatChangelog(diff);
    expect(changelog).toContain("Profile changes from revision 2 to revision 2:");
    expect(changelog).toContain("- Profile name: Saved profile -> Edited profile");
  });
});
