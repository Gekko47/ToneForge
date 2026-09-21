import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { createEmptyProfile, type StyleProfile } from "../../../../src/core/domain/StyleProfile";
import VersionDiff from "../../../../src/taskpane/components/VersionDiff";

function makeProfile(overrides: Partial<StyleProfile> = {}): StyleProfile {
  return {
    ...createEmptyProfile("Saved profile"),
    ...overrides,
    semantic: {
      tone: "neutral",
      voice: "third-person",
      formality: 50,
      readingGradeTarget: null,
      preferredSentenceLength: 22,
      vocabularyRegister: "standard",
      rhetoricalStyle: "direct",
      avoidWords: [],
      ...overrides.semantic,
    },
    typography: {
      emDash: "em",
      emDashSpacing: "spaced",
      enDashSpacing: "spaced",
      doubleQuotes: "curly",
      singleQuotes: "curly",
      apostrophes: "curly",
      decimalSeparator: "dot",
      thousandsSeparator: "none",
      ellipsis: "ellipsis",
      ...overrides.typography,
    },
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
      semantic: { ...saved.semantic, tone: "conversational" },
      houseStyle: { ...saved.houseStyle, bannedTerms: ["utilize"] },
    });

    const { container } = render(<VersionDiff savedProfile={saved} currentProfile={current} />);

    expect(within(container).getByText("Unsaved profile changes")).toBeInTheDocument();
    expect(within(container).getByText("Profile name")).toBeInTheDocument();
    expect(within(container).getByText("Tone")).toBeInTheDocument();
    expect(within(container).getByText("Banned terms")).toBeInTheDocument();
    expect(within(container).getByText("Edited profile")).toBeInTheDocument();
    expect(within(container).getByText("conversational")).toBeInTheDocument();
    expect(within(container).getByText("utilize")).toBeInTheDocument();
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
