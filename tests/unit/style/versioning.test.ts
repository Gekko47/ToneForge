import { describe, expect, it } from "vitest";
import {
  bumpProfileVersion,
  diffProfiles,
  formatChangelog,
  type BumpType,
} from "../../../src/style/versioning";
import { createEmptyProfile } from "../../../src/core/domain/StyleProfile";

describe("bumpProfileVersion", () => {
  const base = { major: 1, minor: 2, patch: 3 };

  it("bumps major and resets minor and patch", () => {
    expect(bumpProfileVersion(base, "major")).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it("bumps minor and resets patch", () => {
    expect(bumpProfileVersion(base, "minor")).toEqual({ major: 1, minor: 3, patch: 0 });
  });

  it("bumps patch", () => {
    expect(bumpProfileVersion(base, "patch")).toEqual({ major: 1, minor: 2, patch: 4 });
  });

  it("handles all bump types via exhaustive switch", () => {
    const types: readonly BumpType[] = ["major", "minor", "patch"];
    expect(types.map((t) => bumpProfileVersion({ major: 0, minor: 0, patch: 0 }, t))).toEqual([
      { major: 1, minor: 0, patch: 0 },
      { major: 0, minor: 1, patch: 0 },
      { major: 0, minor: 0, patch: 1 },
    ]);
  });
});

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

  it("records from and to versions", () => {
    const from = createEmptyProfile("v1", { major: 1, minor: 0, patch: 0 });
    const to = { ...from, version: { major: 1, minor: 1, patch: 0 } };
    const diff = diffProfiles(from, to);
    expect(diff.fromVersion).toEqual({ major: 1, minor: 0, patch: 0 });
    expect(diff.toVersion).toEqual({ major: 1, minor: 1, patch: 0 });
  });
});

describe("formatChangelog", () => {
  it("returns a no-change message when nothing changed", () => {
    const profile = createEmptyProfile("Same");
    const diff = diffProfiles(profile, { ...profile });
    expect(formatChangelog(diff)).toBe("No changes between v1.0.0 and v1.0.0.");
  });

  it("formats changed fields as a list", () => {
    const from = createEmptyProfile("Saved profile");
    const to = { ...from, name: "Edited profile" };
    const diff = diffProfiles(from, to);
    const changelog = formatChangelog(diff);
    expect(changelog).toContain("Profile changes from v1.0.0 to v1.0.0:");
    expect(changelog).toContain("- Profile name: Saved profile -> Edited profile");
  });
});
