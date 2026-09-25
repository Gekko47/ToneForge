import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { StyleProfileSchema, type StyleProfile } from "./StyleProfile";

/**
 * Organizational profile lifecycle.
 *
 * A profile has at most one mutable draft and an ordered list of immutable
 * published versions. Publishing never mutates an existing published version;
 * editing a published version produces a new draft.
 */
export const ProfileLifecycleStateSchema = z.object({
  profileId: z.string().uuid(),
  draft: StyleProfileSchema.nullable().default(null),
  published: z.array(StyleProfileSchema).default([]),
  activePublishedId: z.string().uuid().nullable().default(null),
  revision: z.number().int().nonnegative().default(0),
});

export type ProfileLifecycleState = z.infer<typeof ProfileLifecycleStateSchema>;

export interface LifecycleEvent {
  type: "draft-created" | "draft-updated" | "published" | "activated" | "draft-discarded";
  at: string;
  publishedId: string | null;
  detail: string;
}

export function createLifecycleState(profileId: string): ProfileLifecycleState {
  return ProfileLifecycleStateSchema.parse({
    profileId,
    draft: null,
    published: [],
    activePublishedId: null,
  });
}

function bump(profile: StyleProfile, now: string): StyleProfile {
  return StyleProfileSchema.parse({
    ...profile,
    version: { ...profile.version, patch: profile.version.patch + 1 },
    updatedAt: now,
  });
}

/** Start a draft. When a draft already exists it is returned unchanged. */
export function createDraft(
  state: ProfileLifecycleState,
  seed: StyleProfile,
  now: string,
): ProfileLifecycleState {
  if (state.draft) return state;
  return ProfileLifecycleStateSchema.parse({
    ...state,
    draft: bump(seed, now),
    revision: state.revision + 1,
  });
}

/** Apply an edit to the draft. Published versions are never touched. */
export function updateDraft(
  state: ProfileLifecycleState,
  next: StyleProfile,
  now: string,
): ProfileLifecycleState {
  if (!state.draft) return state;
  return ProfileLifecycleStateSchema.parse({
    ...state,
    draft: bump({ ...next, id: state.profileId, version: state.draft.version }, now),
    revision: state.revision + 1,
  });
}

/**
 * Publish the current draft. The draft is retained as the published snapshot and
 * becomes the active published version, so activation is explicit and auditable.
 */
export function publishDraft(
  state: ProfileLifecycleState,
  now: string,
): { state: ProfileLifecycleState; event: LifecycleEvent } {
  const draft = state.draft;
  if (!draft) throw new Error("Cannot publish a profile without a draft");
  const published = StyleProfileSchema.parse({ ...draft, updatedAt: now });
  const next = ProfileLifecycleStateSchema.parse({
    ...state,
    published: [...state.published, published],
    activePublishedId: published.id,
    revision: state.revision + 1,
  });
  return {
    state: next,
    event: { type: "published", at: now, publishedId: published.id, detail: "Draft published." },
  };
}

export function activatePublished(
  state: ProfileLifecycleState,
  publishedId: string,
  now: string,
): { state: ProfileLifecycleState; event: LifecycleEvent } {
  const exists = state.published.some((entry) => entry.id === publishedId);
  if (!exists) throw new Error(`Published version ${publishedId} is unknown`);
  return {
    state: ProfileLifecycleStateSchema.parse({
      ...state,
      activePublishedId: publishedId,
      revision: state.revision + 1,
    }),
    event: { type: "activated", at: now, publishedId, detail: "Published version activated." },
  };
}

/** Clone a published version into a new editable draft; published stays immutable. */
export function restoreAsDraft(
  state: ProfileLifecycleState,
  publishedId: string,
  now: string,
): { state: ProfileLifecycleState; event: LifecycleEvent } {
  const source = state.published.find((entry) => entry.id === publishedId);
  if (!source) throw new Error(`Published version ${publishedId} is unknown`);
  return {
    state: ProfileLifecycleStateSchema.parse({
      ...state,
      draft: bump(source, now),
      revision: state.revision + 1,
    }),
    event: {
      type: "draft-created",
      at: now,
      publishedId,
      detail: "Published version restored as a draft.",
    },
  };
}

export function discardDraft(
  state: ProfileLifecycleState,
  now: string,
): { state: ProfileLifecycleState; event: LifecycleEvent } {
  if (!state.draft)
    return {
      state,
      event: {
        type: "draft-discarded",
        at: now,
        publishedId: null,
        detail: "No draft to discard.",
      },
    };
  return {
    state: ProfileLifecycleStateSchema.parse({
      ...state,
      draft: null,
      revision: state.revision + 1,
    }),
    event: { type: "draft-discarded", at: now, publishedId: null, detail: "Draft discarded." },
  };
}

/** The profile analysis should consume: the active published version, else the draft. */
export function effectiveProfile(state: ProfileLifecycleState): StyleProfile | null {
  if (state.activePublishedId) {
    const active = state.published.find((entry) => entry.id === state.activePublishedId);
    if (active) return active;
  }
  return state.draft;
}

export function newProfileId(): string {
  return uuidv4();
}
