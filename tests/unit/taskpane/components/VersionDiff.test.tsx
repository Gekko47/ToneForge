import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { createEmptyProfile, type StyleProfile } from "../../../../src/core/domain/StyleProfile";
import { createEmptySemanticStyleProfile } from "../../../../src/core/domain/SemanticStyleProfile";
import { createGovernanceProfile } from "../../../../src/core/domain/GovernanceProfile";
import VersionDiff from "../../../../src/taskpane/components/VersionDiff";
import { sampleTypography } from "../../../fixtures/sampleDocs";

const SEMANTIC = createEmptySemanticStyleProfile();

function makeProfile(overrides: Partial<StyleProfile> = {}): StyleProfile {
  return {
    ...createEmptyProfile("Saved profile"),
    ...overrides,
    // Defaults from the schema, so a dimension added later is present here
    // without this test having to be amended to stay type-correct.
    semantic: { ...SEMANTIC, ...overrides.semantic },
    // Defaults from the schema, so a typography field added later is present
    // here without this test having to be amended to stay type-correct.
    typography: sampleTypography(overrides.typography ?? {}),
    houseStyle: {
      preferredTerminology: {},
      bannedTerms: [],
      capitalization: { sentenceCase: true, titleCaseWords: [] },
      spellingVariant: "en-US",
      ...overrides.houseStyle,
    },
  };
}

function messageBar(container: HTMLElement): HTMLElement {
  return within(container).getByTestId("version-diff-message-text");
}

describe("VersionDiff", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders changed fields against the saved baseline", () => {
    const saved = makeProfile();
    const current = makeProfile({
      name: "Edited profile",
      semantic: { ...saved.semantic, tone: { ...saved.semantic.tone, primary: "persuasive" } },
      houseStyle: { ...saved.houseStyle, bannedTerms: ["utilize"] },
    });

    const { container } = render(<VersionDiff savedProfile={saved} currentProfile={current} />);

    expect(within(container).getByText("Unsaved profile changes")).toBeInTheDocument();
    expect(within(container).getByText("Profile name")).toBeInTheDocument();
    expect(within(container).getByText("Tone")).toBeInTheDocument();
    expect(within(container).getByText("Banned terms")).toBeInTheDocument();
    expect(within(container).getByText("Edited profile")).toBeInTheDocument();
    // Tone is one grouped row under V2, so the changed trait appears inside the
    // rendered group rather than as a cell of its own, and the same text appears
    // once in the diff table and once in the plain-text changelog below it.
    expect(within(container).getAllByText(/primary: persuasive/).length).toBeGreaterThan(0);
    expect(within(container).getByText("utilize")).toBeInTheDocument();
  });

  it("renders a governance-only change when the style profile is unchanged", () => {
    const profile = makeProfile();
    const savedGovernance = createGovernanceProfile(profile);
    const currentGovernance = createGovernanceProfile(profile);
    // Pinned, so it governs. A non-pinned editorial value is not an opinion and
    // `resolveSemantic` would pass the learned dimension straight through.
    currentGovernance.editorial.tone = { primary: "forensic" };
    currentGovernance.editorial.explicitFields = ["tone"];

    const { container } = render(
      <VersionDiff
        savedProfile={profile}
        currentProfile={profile}
        savedGovernanceProfile={savedGovernance}
        currentGovernanceProfile={currentGovernance}
      />,
    );

    expect(within(container).queryByText("No unsaved profile changes.")).not.toBeInTheDocument();
    expect(within(container).getByText("Governance policy changes")).toBeInTheDocument();
    expect(within(container).getByText("Editorial policy")).toBeInTheDocument();
    expect(within(container).getAllByText(/tone: primary: forensic/)).toHaveLength(2);
  });

  it("reports when the draft matches the saved baseline", () => {
    const profile = makeProfile();
    const { container } = render(<VersionDiff savedProfile={profile} currentProfile={profile} />);

    expect(messageBar(container)).toHaveTextContent("No unsaved profile changes.");
  });

  it("explains that no baseline exists for a new profile", () => {
    const { container } = render(
      <VersionDiff savedProfile={null} currentProfile={makeProfile()} />,
    );

    expect(messageBar(container)).toHaveTextContent(
      "Save this profile to establish a baseline for change previews.",
    );
  });

  it("asks the user to resolve validation errors before diffing", () => {
    const { container } = render(
      <VersionDiff savedProfile={makeProfile()} currentProfile={null} />,
    );

    expect(messageBar(container)).toHaveTextContent(
      "Resolve validation errors to preview profile changes.",
    );
  });
});
