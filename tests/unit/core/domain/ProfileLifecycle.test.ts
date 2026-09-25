import { describe, expect, it } from "vitest";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import {
  activatePublished,
  createDraft,
  createLifecycleState,
  discardDraft,
  effectiveProfile,
  publishDraft,
  restoreAsDraft,
  updateDraft,
} from "../../../../src/core/domain/ProfileLifecycle";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-02T00:00:00.000Z";
const T2 = "2026-01-03T00:00:00.000Z";

describe("ProfileLifecycle", () => {
  it("publishes immutably and activates explicitly", () => {
    const seed = createEmptyProfile("Org profile");
    let state = createLifecycleState(seed.id);
    state = createDraft(state, seed, T0);
    const edited = { ...state.draft!, name: "Edited" };
    state = updateDraft(state, edited, T1);

    const first = publishDraft(state, T1);
    state = first.state;
    expect(state.published).toHaveLength(1);
    expect(state.activePublishedId).toBe(state.published[0]?.id);
    expect(first.event.type).toBe("published");

    state = updateDraft(state, { ...state.draft!, name: "Second" }, T2);
    const second = publishDraft(state, T2);
    state = second.state;
    expect(state.published).toHaveLength(2);
    expect(state.published[0]?.name).toBe("Edited");
    expect(state.published[1]?.name).toBe("Second");

    const activated = activatePublished(state, state.published[0]!.id, T2);
    expect(activated.state.activePublishedId).toBe(state.published[0]?.id);
    expect(effectiveProfile(activated.state)?.name).toBe("Edited");
  });

  it("restores a published version as a new draft and can discard it", () => {
    const seed = createEmptyProfile("Org profile");
    let state = createDraft(createLifecycleState(seed.id), seed, T0);
    state = publishDraft(state, T1).state;
    const publishedId = state.published[0]!.id;

    const restored = restoreAsDraft(state, publishedId, T2);
    state = restored.state;
    expect(restored.event.type).toBe("draft-created");
    expect(state.draft).not.toBeNull();
    expect(state.published).toHaveLength(1);

    const discarded = discardDraft(state, T2);
    expect(discarded.state.draft).toBeNull();
    expect(effectiveProfile(discarded.state)?.id).toBe(publishedId);
  });

  it("refuses to publish without a draft or activate an unknown version", () => {
    const state = createLifecycleState(createEmptyProfile("Empty").id);
    expect(() => publishDraft(state, T0)).toThrow("without a draft");
    expect(() => activatePublished(state, "00000000-0000-4000-8000-000000000000", T0)).toThrow(
      "is unknown",
    );
  });
});
