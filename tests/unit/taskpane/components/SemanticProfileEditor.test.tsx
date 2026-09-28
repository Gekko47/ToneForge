import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SemanticProfileEditor from "../../../../src/taskpane/components/SemanticProfileEditor";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";

const SEMANTIC = {
  ...createEmptyProfile("x", 1).semantic,
  tone: "neutral",
  voice: "third-person",
  formality: 50,
  readingGradeTarget: null,
  preferredSentenceLength: 20,
  vocabularyRegister: "standard" as const,
  rhetoricalStyle: "direct",
  avoidWords: ["very"],
};

describe("SemanticProfileEditor", () => {
  it("saves an edited tone rather than only displaying it", async () => {
    /*
     * The whole point of moving these fields off the style tab. There they were
     * rendered read-only while `buildCandidate` wrote them back on every save,
     * so a learned tone was silently reset by an unrelated edit.
     */
    const onSave = vi.fn();
    render(<SemanticProfileEditor semantic={SEMANTIC} onSave={onSave} />);

    const tone = screen.getByLabelText("Tone") as HTMLInputElement;
    await userEvent.clear(tone);
    await userEvent.type(tone, "formal");
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.tab();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ tone: "formal" });
  });

  it("saves once per edit rather than once per keystroke", async () => {
    /*
     * updateDraft assigns a new revision on every save, so a per-keystroke save
     * would fill the revision trail with "n", "fo", "for" — a trail that can no
     * longer tell anyone what a user actually changed.
     */
    const onSave = vi.fn();
    render(<SemanticProfileEditor semantic={SEMANTIC} onSave={onSave} />);

    await userEvent.clear(screen.getByLabelText("Tone"));
    await userEvent.type(screen.getByLabelText("Tone"), "formal");
    await userEvent.tab();

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps the saved tone when the field is cleared rather than storing nothing", async () => {
    const onSave = vi.fn();
    render(<SemanticProfileEditor semantic={SEMANTIC} onSave={onSave} />);

    await userEvent.clear(screen.getByLabelText("Tone"));
    await userEvent.tab();

    // Tone is a required string. Blanking it and saving an empty tone would
    // write a profile that no engine can reason about.
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ tone: "neutral" });
  });

  it("reads a blank reading-grade target as no target, not as zero", async () => {
    const onSave = vi.fn();
    render(<SemanticProfileEditor semantic={SEMANTIC} onSave={onSave} />);

    const grade = screen.getByLabelText(/Reading grade target/i) as HTMLInputElement;
    await userEvent.clear(grade);
    await userEvent.tab();

    // Zero is a real grade. A cleared field means "no target", and a profile
    // that asks for a grade of zero is a different thing from one that has none.
    expect(onSave.mock.calls.at(-1)?.[0]).toMatchObject({ readingGradeTarget: null });
  });

  it("splits the avoid list into one entry per line and drops blanks", async () => {
    const onSave = vi.fn();
    render(<SemanticProfileEditor semantic={SEMANTIC} onSave={onSave} />);

    const avoid = screen.getByLabelText(/Words to avoid/i) as HTMLTextAreaElement;
    await userEvent.clear(avoid);
    await userEvent.type(avoid, "very{enter}{enter}really");
    await userEvent.tab();

    expect(onSave.mock.calls.at(-1)?.[0]).toMatchObject({ avoidWords: ["very", "really"] });
  });

  it("re-seeds when a different profile is edited, rather than keeping stale values", async () => {
    /*
     * Without this the form keeps the previously edited profile's values, and
     * saving writes them onto whichever profile is now open.
     */
    const onSave = vi.fn();
    const { rerender } = render(<SemanticProfileEditor semantic={SEMANTIC} onSave={onSave} />);

    rerender(
      <SemanticProfileEditor
        semantic={{ ...SEMANTIC, tone: "conversational", formality: 20 }}
        onSave={onSave}
      />,
    );

    await waitFor(() =>
      expect((screen.getByLabelText("Tone") as HTMLInputElement).value).toBe("conversational"),
    );
    expect((screen.getByLabelText(/Formality/) as HTMLInputElement).value).toBe("20");
  });
});
