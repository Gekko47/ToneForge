import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SemanticProfileEditor from "../../../../src/taskpane/components/SemanticProfileEditor";
import { createEmptySemanticStyleProfile } from "../../../../src/core/domain/SemanticStyleProfile";
import type { SemanticStyleProfile } from "../../../../src/core/domain/SemanticStyleProfile";

const SEMANTIC: SemanticStyleProfile = {
  ...createEmptySemanticStyleProfile(),
  tone: { primary: "neutral", secondary: [], description: "" },
  formality: { score: 50, label: "" },
  sentenceArchitecture: {
    complexity: "moderate",
    clauseDensity: "medium",
    targetWords: 20,
    coordination: "mixed",
    shortClosingSentence: false,
  },
  lexicalPreferences: {
    toneAvoid: ["very"],
    prefersNeutralVerbs: true,
    evaluativeLanguage: "restrained",
  },
};

/** Fluent renders options in a portal, so choosing one is two clicks. */
async function choose(label: string, option: string): Promise<void> {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(await screen.findByText(option));
}

describe("SemanticProfileEditor", () => {
  it("saves an edited dimension rather than only displaying it", async () => {
    /*
     * The whole point of moving these fields off the style tab. There they were
     * rendered read-only while `buildCandidate` wrote them back on every save,
     * so a learned tone was silently reset by an unrelated edit.
     *
     * Every dimension is now a closed enum rather than a free string, so the
     * control is a dropdown. That is not cosmetic: V1 accepted any text as a
     * tone, which meant a typo was indistinguishable from a style decision and
     * both were saved.
     */
    const onSave = vi.fn();
    render(<SemanticProfileEditor semantic={SEMANTIC} onSave={onSave} />);

    await choose("Primary tone", "Assertive");

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ tone: { primary: "assertive" } });
  });

  it("saves once per edit rather than once per keystroke", async () => {
    /*
     * `updateDraft` assigns a new revision on every save, so a per-keystroke save
     * would fill the revision trail with "2", "20", "24" — a trail that can no
     * longer tell anyone what a user actually changed.
     */
    const onSave = vi.fn();
    render(<SemanticProfileEditor semantic={SEMANTIC} onSave={onSave} />);

    const field = screen.getByLabelText(/Sentence length/);
    await userEvent.clear(field);
    await userEvent.type(field, "24");
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.tab();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it("clamps a number to its documented range instead of storing it raw", async () => {
    /*
     * The bound is the schema's, and the control states it in its own label
     * ("Sentence length (5-60)"). Storing 900 would produce a profile no engine
     * can reason about, and the Zod check would refuse the save — leaving a field
     * that silently discards what was typed into it.
     */
    const onSave = vi.fn();
    render(<SemanticProfileEditor semantic={SEMANTIC} onSave={onSave} />);

    const field = screen.getByLabelText(/Sentence length/);
    await userEvent.clear(field);
    await userEvent.type(field, "900");
    await userEvent.tab();

    await waitFor(() =>
      expect(onSave.mock.calls.at(-1)?.[0]).toMatchObject({
        sentenceArchitecture: { targetWords: 60 },
      }),
    );
  });

  it("keeps the stored value when the number is cleared, rather than storing nothing", async () => {
    const onSave = vi.fn();
    render(<SemanticProfileEditor semantic={SEMANTIC} onSave={onSave} />);

    const field = screen.getByLabelText(/Sentence length/);
    await userEvent.clear(field);
    await userEvent.tab();

    // A blank field is not a sentence length of zero; it is an absent edit, and
    // the value the profile already had is the truth.
    expect(onSave).not.toHaveBeenCalled();
  });

  it("splits the tone-avoid list into one entry per line and drops blanks", async () => {
    const onSave = vi.fn();
    render(<SemanticProfileEditor semantic={SEMANTIC} onSave={onSave} />);

    const avoid = screen.getByLabelText(/Words to avoid for tone/i) as HTMLTextAreaElement;
    // One change event carrying the whole textarea value, rather than a
    // keystroke sequence. Each edit clones the `semantic` prop, so a stream of
    // events against a frozen prop would have every one of them start from the
    // original and the last would win with a single character. That is a real
    // property of the component, and this case is about the line-splitting, not
    // about how a paste is delivered.
    fireEvent.change(avoid, { target: { value: "very\n\nreally" } });

    // Normalisation happens on blur, not on the keystroke: committing per keystroke
    // stripped the blank line and any trailing space as they were typed.
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.blur(avoid);

    await waitFor(() =>
      expect(onSave.mock.calls.at(-1)?.[0]).toMatchObject({
        lexicalPreferences: { toneAvoid: ["very", "really"] },
      }),
    );
  });

  it("keeps blank lines and trailing spaces visible while the field is being typed in", async () => {
    const onSave = vi.fn();
    render(<SemanticProfileEditor semantic={SEMANTIC} onSave={onSave} />);

    const avoid = screen.getByLabelText(/Words to avoid for tone/i) as HTMLTextAreaElement;
    fireEvent.change(avoid, { target: { value: "very \n\nreally" } });

    // The draft is what the user sees. Normalising it here is what made the list
    // reshape itself under the caret mid-entry.
    expect((avoid as HTMLTextAreaElement).value).toBe("very \n\nreally");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("re-seeds when a different profile is edited, rather than keeping stale values", async () => {
    /*
     * Without this the form keeps the previously edited profile's values, and
     * saving writes them onto whichever profile is now open.
     *
     * The numeric field holds local draft state for the keystroke, so it is the
     * one place a stale value can survive a profile switch; the dropdowns read
     * straight from props and cannot.
     */
    const onSave = vi.fn();
    const { rerender } = render(<SemanticProfileEditor semantic={SEMANTIC} onSave={onSave} />);

    rerender(
      <SemanticProfileEditor
        semantic={{
          ...SEMANTIC,
          sentenceArchitecture: {
            ...SEMANTIC.sentenceArchitecture,
            targetWords: 30,
          },
        }}
        onSave={onSave}
      />,
    );

    await waitFor(() =>
      expect((screen.getByLabelText(/Sentence length/) as HTMLInputElement).value).toBe("30"),
    );
  });

  it("states a migrated profile's unmappable values instead of hiding them", () => {
    /*
     * V2 has no home for a V1 reading-grade target or vocabulary register, so the
     * migration carries them in `legacyV1`. A value the editor cannot show is a
     * value that would otherwise look as though it had never existed — so the
     * carrier is surfaced, with the statement that nothing reads it.
     */
    render(
      <SemanticProfileEditor
        semantic={{
          ...SEMANTIC,
          legacyV1: {
            readingGradeTarget: 14,
            vocabularyRegister: "academic",
            tone: "restrained",
            voice: "third-person",
            rhetoricalStyle: "direct",
          },
        }}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText(/reading grade target 14/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing reads them/i)).toBeInTheDocument();
  });

  it("does not claim a migrated carrier on a profile that never had one", () => {
    /*
     * `legacyV1` is optional precisely so its absence is a signal. A default of
     * `{}` would make "nothing was carried" indistinguishable from "nothing
     * needed carrying", and the notice above would appear on every new profile.
     */
    render(<SemanticProfileEditor semantic={SEMANTIC} onSave={vi.fn()} />);

    expect(screen.queryByText(/carried from an earlier style profile/i)).toBeNull();
  });
});
