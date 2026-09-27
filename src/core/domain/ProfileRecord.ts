import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  ProfileKindSchema,
  StyleProfileSchema,
  type ProfileKind,
  type StyleProfile,
} from "./StyleProfile";

/**
 * The single persisted record for one style profile.
 *
 * A record owns everything about a profile: its identity, the one editable
 * draft, the immutable published versions, and the full revision audit trail.
 * Nothing else stores profile data, so there is exactly one write path and no
 * two structures that can disagree.
 *
 * Revisions are plain monotonically increasing integers. A snapshot carries its
 * own revision number, so a stored revision is self-identifying and a
 * ChangePlan can cite the exact revision it was built from.
 */

/** An approved, immutable published version. */
export const PublishedVersionSchema = z.object({
  revision: z.number().int().positive(),
  at: z.string().datetime(),
  profile: StyleProfileSchema,
});

export type PublishedVersion = z.infer<typeof PublishedVersionSchema>;

export const PROFILE_REVISION_ACTIONS = [
  "created",
  "draft-updated",
  "published",
  "activated",
  "restored",
  "draft-discarded",
] as const;

export const ProfileRevisionActionSchema = z.enum(PROFILE_REVISION_ACTIONS);
export type ProfileRevisionAction = z.infer<typeof ProfileRevisionActionSchema>;

/** One immutable audit entry holding a full snapshot. */
export const ProfileRevisionSchema = z.object({
  revision: z.number().int().positive(),
  at: z.string().datetime(),
  action: ProfileRevisionActionSchema,
  detail: z.string(),
  profile: StyleProfileSchema,
});

export type ProfileRevision = z.infer<typeof ProfileRevisionSchema>;

export const ProfileRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1),
  kind: ProfileKindSchema.default("deterministic"),
  draft: StyleProfileSchema.nullable().default(null),
  published: z.array(PublishedVersionSchema).default([]),
  revisions: z.array(ProfileRevisionSchema).default([]),
  activePublishedRevision: z.number().int().positive().nullable().default(null),
  nextRevision: z.number().int().positive().default(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ProfileRecord = z.infer<typeof ProfileRecordSchema>;

/** Newest revisions always retained before published versions are protected. */
export const REVISION_RETENTION_CAP = 20;

export function newProfileId(): string {
  return uuidv4();
}

export interface RecordTransition {
  record: ProfileRecord;
  revision: ProfileRevision;
}

/**
 * Append one audit entry, applying the retention cap. The cap keeps the newest
 * `cap` entries and never drops an entry whose revision is a published
 * version, so an approved version always remains auditable.
 *
 * `bumpNextRevision` is false for publishing, because publishing does not create
 * a new revision: it promotes the draft that already has one. Bumping there would
 * leave a gap in the sequence — publish r4, then the next edit would be r6.
 */
function append(
  record: ProfileRecord,
  entry: ProfileRevision,
  cap: number = REVISION_RETENTION_CAP,
  bumpNextRevision = true,
): ProfileRecord {
  const revisions = [...record.revisions, entry];
  const recentFrom = Math.max(0, revisions.length - cap);
  const protectedNumbers = new Set(record.published.map((entry_) => entry_.revision));
  const trimmed = revisions.filter(
    (candidate, index) => index >= recentFrom || protectedNumbers.has(candidate.revision),
  );
  return ProfileRecordSchema.parse({
    ...record,
    revisions: trimmed,
    nextRevision: bumpNextRevision ? record.nextRevision + 1 : record.nextRevision,
    updatedAt: entry.at,
  });
}

/** Create a record, optionally seeding a first draft, and record revision 1. */
export function createRecord(
  id: string,
  name: string,
  now: string,
  seed?: StyleProfile,
  kind: ProfileKind = "deterministic",
): ProfileRecord {
  const base = ProfileRecordSchema.parse({
    id,
    name,
    kind,
    draft: null,
    published: [],
    revisions: [],
    activePublishedRevision: null,
    nextRevision: 1,
    createdAt: now,
    updatedAt: now,
  });
  if (!seed) return base;

  // The kind is forced onto the seed rather than read from it, so a record and
  // the profile it holds can never disagree about which half they belong to.
  const profile = StyleProfileSchema.parse({ ...seed, id, revision: 1, kind, updatedAt: now });
  return append(
    { ...base, draft: profile },
    {
      revision: 1,
      at: now,
      action: "created",
      detail: "Profile created.",
      profile,
    },
  );
}

/**
 * Apply an edit to the draft. The draft always moves to the next revision, so
 * the audit trail records every save. Published versions are never touched.
 */
export function updateDraft(
  record: ProfileRecord,
  next: StyleProfile,
  now: string,
): RecordTransition {
  const revision = record.nextRevision;
  const profile = StyleProfileSchema.parse({
    ...next,
    id: record.id,
    name: next.name.trim() || record.name,
    revision,
    updatedAt: now,
  });
  return {
    record: append(
      { ...record, name: profile.name, draft: profile },
      { revision, at: now, action: "draft-updated", detail: "Draft saved.", profile },
    ),
    revision: { revision, at: now, action: "draft-updated", detail: "Draft saved.", profile },
  };
}

/**
 * Publish the current draft in place and activate it.
 *
 * Publishing does **not** create a new revision. The draft already carries a
 * number that identifies its content, and the deterministic review cites that
 * number; minting a second number for the same content would mean the revision a
 * plan was built from and the revision the user approved were different labels
 * for one thing. So the draft is promoted at its own revision, and the next
 * *edit* — not the publish — starts the next number.
 *
 * Two consequences, both deliberate:
 *
 * - Publishing twice at the same revision **replaces** the earlier published
 *   entry rather than appending a second copy. Two entries claiming to be r4
 *   with different timestamps would be indistinguishable to a reader.
 * - The audit trail may therefore hold two entries for one revision (the
 *   `draft-updated` that created it and the `published` that promoted it).
 *   A revision number identifies a *version of the content*, not a single event.
 */
export function publishDraft(record: ProfileRecord, now: string): RecordTransition {
  const draft = record.draft;
  if (!draft) throw new Error("Cannot publish a profile without a draft");

  const revision = draft.revision;
  const profile = StyleProfileSchema.parse({ ...draft, revision, updatedAt: now });
  const version: PublishedVersion = { revision, at: now, profile };
  const entry: ProfileRevision = {
    revision,
    at: now,
    action: "published",
    detail: `Revision ${revision} published.`,
    profile,
  };
  const published = [...record.published.filter((item) => item.revision !== revision), version];

  return {
    record: append(
      {
        ...record,
        draft: profile,
        published,
        activePublishedRevision: revision,
      },
      entry,
      REVISION_RETENTION_CAP,
      false,
    ),
    revision: entry,
  };
}

/** Activate a published version. Throws if that revision was never published. */
export function activatePublished(
  record: ProfileRecord,
  revision: number,
  now: string,
): RecordTransition {
  const version = record.published.find((entry) => entry.revision === revision);
  if (!version) throw new Error(`Published revision ${revision} is unknown`);

  const entry: ProfileRevision = {
    revision: record.nextRevision,
    at: now,
    action: "activated",
    detail: `Revision ${revision} activated.`,
    profile: version.profile,
  };
  return {
    record: append({ ...record, activePublishedRevision: revision }, entry),
    revision: entry,
  };
}

/** Clone a published version into a new editable draft. Published stays immutable. */
export function restoreAsDraft(
  record: ProfileRecord,
  revision: number,
  now: string,
): RecordTransition {
  const version = record.published.find((entry) => entry.revision === revision);
  if (!version) throw new Error(`Published revision ${revision} is unknown`);

  const next = record.nextRevision;
  const profile = StyleProfileSchema.parse({ ...version.profile, revision: next, updatedAt: now });
  const entry: ProfileRevision = {
    revision: next,
    at: now,
    action: "restored",
    detail: `Revision ${revision} restored as a draft.`,
    profile,
  };
  return {
    record: append({ ...record, draft: profile }, entry),
    revision: entry,
  };
}

/**
 * Clone any audited revision into a new editable draft.
 *
 * `restoreAsDraft` can only reach published versions, so a profile that has
 * never been published — the normal state of a freshly created record — has no
 * way back to its own earlier content. Every entry in `revisions` already holds
 * a full snapshot, so recall reads from there instead of inventing a second
 * history.
 *
 * It creates a draft and nothing else. It does not activate anything: documents
 * are checked against the active published revision, and a recall that silently
 * promoted an old snapshot would change what the user was measured against
 * without their having published it. Publishing stays an explicit second step.
 */
export function recallRevisionAsDraft(
  record: ProfileRecord,
  revision: number,
  now: string,
): RecordTransition {
  const source = findRevision(record, revision);
  if (!source) throw new Error(`Revision ${revision} is not in this record's audit trail`);

  const next = record.nextRevision;
  const profile = StyleProfileSchema.parse({ ...source.profile, revision: next, updatedAt: now });
  const entry: ProfileRevision = {
    revision: next,
    at: now,
    action: "restored",
    detail: `Revision ${revision} recalled as a draft.`,
    profile,
  };
  return {
    record: append({ ...record, draft: profile }, entry),
    revision: entry,
  };
}

/** Discard the draft. The revision is still recorded so the trail stays complete. */
export function discardDraft(record: ProfileRecord, now: string): RecordTransition {
  const draft = record.draft;
  if (!draft) throw new Error("Cannot discard a profile without a draft");

  const entry: ProfileRevision = {
    revision: record.nextRevision,
    at: now,
    action: "draft-discarded",
    detail: "Draft discarded.",
    profile: draft,
  };
  return { record: append({ ...record, draft: null }, entry), revision: entry };
}

/** The profile analysis consumes: the active published version, else the draft. */
export function effectiveProfile(record: ProfileRecord): StyleProfile | null {
  if (record.activePublishedRevision !== null) {
    const active = record.published.find(
      (entry) => entry.revision === record.activePublishedRevision,
    );
    if (active) return active.profile;
  }
  return record.draft;
}

/**
 * The newest audit entry for a revision.
 *
 * Publishing no longer mints a new number, so one revision can have more than one
 * entry — the `draft-updated` that created it and the `published` that promoted
 * it. `find` would return whichever happened to be first, which is the *older*
 * event; the last match is the current state of that revision, which is what
 * recall needs to copy back into a draft.
 */
export function findRevision(record: ProfileRecord, revision: number): ProfileRevision | undefined {
  return [...record.revisions].reverse().find((entry) => entry.revision === revision);
}
