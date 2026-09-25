import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import {
  activatePublished,
  createLifecycleState,
  newProfileId,
  restoreAsDraft,
  type ProfileLifecycleState,
} from "../../../../src/core/domain/ProfileLifecycle";
import ProfileLifecycleSection from "../../../../src/taskpane/components/ProfileLifecycleSection";
import * as persistence from "../../../../src/core/state/persistence";
import type * as persistenceModule from "../../../../src/core/state/persistence";

vi.mock("../../../../src/core/state/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof persistenceModule>();
  return { ...actual, saveProfileLifecycle: vi.fn() };
});

const profile = createEmptyProfile("House");
const STAMP = "2026-01-01T00:00:00.000Z";

function withTwoPublished(): ProfileLifecycleState {
  const base = createLifecycleState(profile.id);
  // Published versions are distinct immutable snapshots, so each needs its own id.
  const first = { ...profile, id: newProfileId(), name: "House v1" };
  const second = { ...profile, id: newProfileId(), name: "House v2" };
  const published = [first, second];
  return {
    ...base,
    published,
    activePublishedId: second.id,
    revision: 2,
  };
}

describe("ProfileLifecycleSection", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.mocked(persistence.saveProfileLifecycle).mockClear();
  });

  it("disables publishing without a draft and explains why", () => {
    render(<ProfileLifecycleSection lifecycle={withTwoPublished()} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Publish draft" })).toBeDisabled();
    expect(screen.getByText("Create or edit a draft to publish a version.")).toBeTruthy();
  });

  it("publishes a draft and announces the new revision once", async () => {
    const user = userEvent.setup();
    const withDraft: ProfileLifecycleState = { ...withTwoPublished(), draft: profile };
    const onChange = vi.fn();
    render(<ProfileLifecycleSection lifecycle={withDraft} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Publish draft" }));

    expect(vi.mocked(persistence.saveProfileLifecycle)).toHaveBeenCalledTimes(1);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Draft published.");
    expect(status.textContent).toContain("Revision 3");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("activates an earlier version explicitly without mutating it", async () => {
    const user = userEvent.setup();
    const state = withTwoPublished();
    const firstId = state.published[0]?.id ?? "";
    const onChange = vi.fn();
    render(<ProfileLifecycleSection lifecycle={state} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: /Activate published version 1 of 2/ }));

    const next = onChange.mock.calls[0]?.[0] as ProfileLifecycleState;
    expect(next.activePublishedId).toBe(firstId);
    expect(activatePublished(state, firstId, STAMP).state.activePublishedId).toBe(firstId);
    expect(next.published).toHaveLength(2);
  });

  it("restores a published version as a draft instead of editing it", async () => {
    const user = userEvent.setup();
    const state = withTwoPublished();
    const onChange = vi.fn();
    render(<ProfileLifecycleSection lifecycle={state} onChange={onChange} />);

    await user.click(
      screen.getByRole("button", { name: /Restore published version 1 of 2 as a draft/ }),
    );

    const next = onChange.mock.calls[0]?.[0] as ProfileLifecycleState;
    expect(next.draft).not.toBeNull();
    expect(next.published).toEqual(state.published);
    expect(restoreAsDraft(state, state.published[0]?.id ?? "", STAMP).state.draft).not.toBeNull();
  });

  it("renders a side-by-side comparison once more than one version is published", () => {
    render(<ProfileLifecycleSection lifecycle={withTwoPublished()} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Profile history comparison")).toBeTruthy();
    expect(screen.getByText("Profile name")).toBeTruthy();
  });

  it("does not render a comparison for a single published version", () => {
    const single: ProfileLifecycleState = {
      ...withTwoPublished(),
      published: [profile],
      activePublishedId: profile.id,
    };
    render(<ProfileLifecycleSection lifecycle={single} onChange={vi.fn()} />);

    expect(screen.queryByLabelText("Profile history comparison")).toBeNull();
    expect(vi.mocked(persistence.saveProfileLifecycle)).not.toHaveBeenCalled();
  });
});
