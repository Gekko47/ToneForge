import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createEmptyProfile } from "../../../../src/core/domain/StyleProfile";
import {
  createRecord,
  newProfileId,
  publishDraft,
  type ProfileRecord,
} from "../../../../src/core/domain/ProfileRecord";
import ProfileRecordSection from "../../../../src/taskpane/components/ProfileRecordSection";

const STAMP = "2026-01-01T00:00:00.000Z";

function record(): ProfileRecord {
  return createRecord(newProfileId(), "House", STAMP, createEmptyProfile("House", 1));
}

function published(): ProfileRecord {
  return publishDraft(record(), STAMP).record;
}

function draftOf(rec: ProfileRecord) {
  const draft = rec.draft;
  if (!draft) throw new Error("expected the record to have a draft");
  return draft;
}

/** A record with two published versions, so comparison is meaningful. */
function twicePublished(): ProfileRecord {
  const first = published();
  return publishDraft({ ...first, draft: { ...draftOf(first), name: "House v2" } }, STAMP).record;
}

describe("ProfileRecordSection", () => {
  it("reports an empty state truthfully when nothing is published", () => {
    render(<ProfileRecordSection record={record()} onChange={vi.fn()} />);

    expect(screen.getByTestId("record-summary")).toHaveTextContent("Draft: revision 1");
    expect(screen.getByTestId("record-summary")).toHaveTextContent("Published versions: 0");
    expect(screen.getByText("No published versions yet.")).toBeInTheDocument();
    // The creation is already revision 1, so the trail is not empty.
    expect(screen.queryByText("No revisions recorded yet.")).not.toBeInTheDocument();
  });

  it("disables publish and discard when there is no draft", () => {
    const discarded = { ...published(), draft: null };
    render(<ProfileRecordSection record={discarded} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Publish draft" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard draft" })).toBeDisabled();
    expect(screen.getByText("Create or edit a draft to publish a version.")).toBeInTheDocument();
  });

  it("publishes a draft and announces the new revision in one status region", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<ProfileRecordSection record={record()} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Publish draft" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as ProfileRecord;
    expect(next.published).toHaveLength(1);
    expect(next.activePublishedRevision).toBe(next.published[0]?.revision);

    const statuses = within(container).getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveAttribute("aria-live", "polite");
    expect(statuses[0]).toHaveTextContent("Draft published.");
  });

  it("marks the active published version instead of offering to activate it", () => {
    const rec = published();
    render(<ProfileRecordSection record={rec} onChange={vi.fn()} />);

    const list = screen.getByRole("list", { name: "Published versions" });
    expect(within(list).getByText("Active version")).toBeInTheDocument();
    expect(
      within(list).queryByRole("button", {
        name: `Activate published revision ${rec.published[0]?.revision}`,
      }),
    ).not.toBeInTheDocument();
  });

  it("activates an older published version on explicit request", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const rec = published();
    const renamed = {
      ...rec,
      draft: rec.draft ? { ...rec.draft, name: "House v2" } : null,
    };
    const second = publishDraft(renamed, STAMP).record;
    const firstRevision = second.published[0]?.revision ?? 0;
    const latest = second.published[second.published.length - 1]?.revision ?? 0;

    render(<ProfileRecordSection record={second} onChange={onChange} />);
    await user.click(
      screen.getByRole("button", { name: `Activate published revision ${firstRevision}` }),
    );

    const next = onChange.mock.calls[0]?.[0] as ProfileRecord;
    expect(next.activePublishedRevision).toBe(firstRevision);
    expect(latest).not.toBe(firstRevision);
    // Activation never rewrites the immutable published list.
    expect(next.published).toEqual(second.published);
  });

  it("restores a published version as a new draft", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const rec = published();
    const target = rec.published[0]?.revision ?? 0;

    render(<ProfileRecordSection record={rec} onChange={onChange} />);
    await user.click(
      screen.getByRole("button", { name: `Restore published revision ${target} as a draft` }),
    );

    const next = onChange.mock.calls[0]?.[0] as ProfileRecord;
    expect(next.draft).not.toBeNull();
    // The restored content is a new draft, not a rewind of the published list.
    expect(next.published).toEqual(rec.published);
    expect(next.revisions[next.revisions.length - 1]?.action).toBe("restored");
  });

  it("discards the draft while keeping every published version", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const rec = published();

    render(<ProfileRecordSection record={rec} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Discard draft" }));

    const next = onChange.mock.calls[0]?.[0] as ProfileRecord;
    expect(next.draft).toBeNull();
    expect(next.published).toEqual(rec.published);
  });

  it("lists the audit trail newest first with each action spelled out", () => {
    const rec = published();
    render(<ProfileRecordSection record={rec} onChange={vi.fn()} />);

    const trail = within(screen.getByRole("list", { name: "Revision audit trail" })).getAllByRole(
      "listitem",
    );
    expect(trail[0]).toHaveTextContent("published");
    expect(trail[trail.length - 1]).toHaveTextContent("Profile created.");
    expect(trail).toHaveLength(2);
  });

  it("offers a side-by-side comparison only once two versions exist", () => {
    const { rerender } = render(<ProfileRecordSection record={published()} onChange={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "Profile history comparison" })).toBeNull();

    rerender(<ProfileRecordSection record={twicePublished()} onChange={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Profile history comparison" })).toBeInTheDocument();
  });
});
