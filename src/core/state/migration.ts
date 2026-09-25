/**
 * State schema migrations keyed by version.
 * Kept in code so future schema changes are explicit and testable.
 */

import { z } from "zod";
import { StyleProfileSchema, type StyleProfile } from "../domain/StyleProfile";
import { GovernanceProfileSchema, type GovernanceProfile } from "../domain/GovernanceProfile";
import {
  effectiveProfile,
  ProfileRecordSchema,
  type ProfileRecord,
  type ProfileRevision,
  type PublishedVersion,
} from "../domain/ProfileRecord";
import { type PersistedState } from "./persistence";

export const CURRENT_STATE_VERSION = 7;

const DEFAULT_SETTINGS: PersistedState["settings"] = {
  llmProvider: "mock",
  openAiCredentialMode: "broker",
  spotReviewConsent: false,
  fullDocumentReviewConsent: false,
  telemetryDisabled: true,
  semanticOptIn: false,
};

const DEFAULT_GOVERNANCE_PROFILES: Record<string, GovernanceProfile> = {};
const DEFAULT_GOVERNANCE_HISTORY: Record<string, GovernanceProfile[]> = {};

/** Create a minimal governance profile from a StyleProfile for migration seeding. */
function seedGovernanceProfile(style: StyleProfile): GovernanceProfile {
  const now = new Date().toISOString();
  return GovernanceProfileSchema.parse({
    id: style.id,
    version: 1,
    style,
    rules: [],
    terminology: {},
    scope: {},
    protection: {},
    editorial: {},
    provenance: {
      createdAt: now,
      createdBy: "migration",
      lineage: [],
    },
  });
}

/**
 * Migrate an unknown persisted state to the current schema version.
 * Returns a default state when the input is unparseable or too old.
 */
export function migrate(raw: unknown): PersistedState {
  if (raw === null || raw === undefined) {
    return defaultState();
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return defaultState();
  }

  const obj = raw as Record<string, unknown>;
  const version = typeof obj.version === "number" ? obj.version : 0;

  switch (version) {
    case 0:
      return migrateLegacyToCurrent(obj);
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
    case 6:
      return migrateLegacyToCurrent(obj);
    case CURRENT_STATE_VERSION:
      return readCurrentState(obj);
    default:
      return defaultState();
  }
}

function defaultState(): PersistedState {
  return {
    version: CURRENT_STATE_VERSION,
    profileRecords: {},
    activeProfileId: null,
    governanceProfiles: DEFAULT_GOVERNANCE_PROFILES,
    governanceHistory: DEFAULT_GOVERNANCE_HISTORY,
    activeGovernanceProfileId: null,
    settings: { ...DEFAULT_SETTINGS },
  };
}

function readCurrentState(obj: Record<string, unknown>): PersistedState {
  // Normalize first so the active id is validated against the records that
  // actually survive, not the raw input: a record dropped as invalid must not
  // stay reachable through activeProfileId.
  const profileRecords = normalizeRecords(obj.profileRecords);
  return {
    version: CURRENT_STATE_VERSION,
    profileRecords,
    activeProfileId: normalizeActiveProfileId(obj.activeProfileId, profileRecords),
    governanceProfiles: normalizeGovernanceProfiles(obj.governanceProfiles),
    governanceHistory: normalizeGovernanceHistory(obj.governanceHistory, obj.governanceProfiles),
    activeGovernanceProfileId: normalizeActiveGovernanceProfileId(obj.activeGovernanceProfileId),
    settings: normalizeSettings(obj.settings),
  };
}

function readLegacyState(obj: Record<string, unknown>): PersistedState {
  const records = buildRecordsFromLegacy(obj);
  const activeProfileId = normalizeActiveProfileIdFromProfiles(obj.activeProfileId, obj.profiles);
  const governanceProfiles = seedMissingGovernance(
    normalizeGovernanceProfiles(obj.governanceProfiles),
    records,
  );
  return {
    version: CURRENT_STATE_VERSION,
    profileRecords: records,
    activeProfileId,
    governanceProfiles,
    governanceHistory: normalizeGovernanceHistory(obj.governanceHistory, governanceProfiles),
    // Pre-v3 state had no governance id, so the active style profile is the
    // only governance policy that can have been in force.
    activeGovernanceProfileId:
      normalizeActiveGovernanceProfileId(obj.activeGovernanceProfileId) ?? activeProfileId,
    settings: normalizeSettings(obj.settings),
  };
}

/** Every record needs a normative policy, even if the legacy state had none. */
function seedMissingGovernance(
  stored: Record<string, GovernanceProfile>,
  records: Record<string, ProfileRecord>,
): Record<string, GovernanceProfile> {
  const result = { ...stored };
  Object.values(records).forEach((record) => {
    if (result[record.id]) return;
    const style = effectiveProfile(record);
    if (style) result[record.id] = seedGovernanceProfile(style);
  });
  return result;
}

function migrateLegacyToCurrent(raw: Record<string, unknown>): PersistedState {
  return readLegacyState(raw);
}

/**
 * Fold the pre-v7 structures into one record per profile.
 *
 * v0-v4 stored `profiles` and a `profileHistory` edit trail; v5-v6 additionally
 * stored a `profileLifecycles` approval trail. Both trails are preserved: the
 * edit trail becomes `revisions` and the approval trail becomes `published`.
 * Where a revision number appears in both, the published entry wins for that
 * number, because a published snapshot is the authoritative content.
 */
function buildRecordsFromLegacy(obj: Record<string, unknown>): Record<string, ProfileRecord> {
  const profiles = normalizeProfiles(obj.profiles);
  const editTrail = normalizeProfileHistory(obj.profileHistory, profiles);
  const lifecycles = normalizeLifecycles(obj.profileLifecycles);
  const records: Record<string, ProfileRecord> = {};

  profiles.forEach((profile) => {
    const trail = (editTrail[profile.id] ?? [profile]).filter(
      (snapshot) => snapshot.id === profile.id,
    );
    const lifecycle = lifecycles[profile.id];
    const publishedSnapshots = (lifecycle?.published ?? []).filter(
      (snapshot) => snapshot.id === profile.id,
    );

    // The approval trail is authoritative; fall back to the latest edit.
    const publishedSource =
      publishedSnapshots.length > 0 ? publishedSnapshots : [trail[trail.length - 1] ?? profile];
    const activeIndex = Math.max(
      0,
      publishedSource.findIndex((entry) => entry.id === lifecycle?.activePublishedId),
    );

    const published: PublishedVersion[] = publishedSource.map((snapshot, index) => ({
      revision: index + 1,
      at: snapshot.updatedAt,
      profile: withRevision(snapshot, index + 1),
    }));

    // The edit trail becomes the audit trail, renumbered to avoid colliding with
    // published numbers: published owns 1..N, the edit trail continues after.
    const revisions: ProfileRevision[] = trail.map((snapshot, index) => ({
      revision: published.length + index + 1,
      at: snapshot.updatedAt,
      action: index === 0 ? "created" : "draft-updated",
      detail: index === 0 ? "Profile created." : "Draft saved.",
      profile: withRevision(snapshot, published.length + index + 1),
    }));

    const latest = revisions[revisions.length - 1];
    records[profile.id] = ProfileRecordSchema.parse({
      id: profile.id,
      name: profile.name,
      draft: latest ? latest.profile : null,
      published,
      revisions,
      activePublishedRevision: published[activeIndex]?.revision ?? null,
      nextRevision: (latest?.revision ?? published.length) + 1,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    });
  });

  return records;
}

function withRevision(profile: StyleProfile, revision: number): StyleProfile {
  return StyleProfileSchema.parse({ ...profile, revision });
}

function normalizeRecords(raw: unknown): Record<string, ProfileRecord> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, ProfileRecord> = {};
  Object.entries(raw as Record<string, unknown>).forEach(([id, record]) => {
    if (!z.string().uuid().safeParse(id).success) return;
    const parsed = ProfileRecordSchema.safeParse(record);
    if (parsed.success && parsed.data.id === id) {
      result[id] = parsed.data;
    }
  });
  return result;
}

function normalizeLifecycles(raw: unknown): Record<string, ProfileLifecycleShape> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, ProfileLifecycleShape> = {};
  Object.entries(raw as Record<string, unknown>).forEach(([id, lifecycle]) => {
    if (!z.string().uuid().safeParse(id).success) return;
    const parsed = z
      .object({
        published: z.array(StyleProfileSchema).default([]),
        activePublishedId: z.string().nullable().default(null),
      })
      .safeParse(lifecycle);
    if (!parsed.success) return;
    result[id] = {
      published: parsed.data.published.filter((entry) => entry.id === id),
      activePublishedId: parsed.data.activePublishedId,
    };
  });
  return result;
}

interface ProfileLifecycleShape {
  published: StyleProfile[];
  activePublishedId: string | null;
}

function normalizeGovernanceHistory(
  raw: unknown,
  profiles: unknown,
): Record<string, GovernanceProfile[]> {
  const normalizedProfiles = normalizeGovernanceProfiles(profiles);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return Object.fromEntries(
      Object.entries(normalizedProfiles).map(([id, profile]) => [id, [profile]]),
    );
  }
  const result: Record<string, GovernanceProfile[]> = {};
  for (const [id, snapshots] of Object.entries(raw as Record<string, unknown>)) {
    if (!z.string().uuid().safeParse(id).success || !Array.isArray(snapshots)) continue;
    const valid = snapshots
      .map((snapshot) => GovernanceProfileSchema.safeParse(snapshot))
      .filter(
        (entry): entry is { success: true; data: GovernanceProfile } =>
          entry.success && entry.data.id === id,
      )
      .map((entry) => entry.data);
    if (valid.length > 0) result[id] = valid;
  }
  for (const [id, profile] of Object.entries(normalizedProfiles)) {
    if (!result[id]) result[id] = [profile];
  }
  return result;
}

function normalizeGovernanceProfiles(raw: unknown): Record<string, GovernanceProfile> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_GOVERNANCE_PROFILES;
  }
  const result: Record<string, GovernanceProfile> = {};
  for (const [id, profile] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = GovernanceProfileSchema.safeParse(profile);
    if (parsed.success) {
      result[id] = parsed.data;
    }
  }
  return result;
}

function normalizeActiveGovernanceProfileId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return raw;
}

function normalizeProfiles(raw: unknown): StyleProfile[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((snapshot) => StyleProfileSchema.safeParse(snapshot))
    .filter((result): result is { success: true; data: StyleProfile } => result.success)
    .map((result) => result.data);
}

function normalizeActiveProfileIdFromProfiles(raw: unknown, rawProfiles: unknown): string | null {
  const profiles = normalizeProfiles(rawProfiles);
  if (typeof raw !== "string" || !profiles.some((profile) => profile.id === raw)) {
    return null;
  }
  return raw;
}

function normalizeActiveProfileId(
  raw: unknown,
  records: Record<string, ProfileRecord>,
): string | null {
  if (typeof raw !== "string") return null;
  return Object.prototype.hasOwnProperty.call(records, raw) ? raw : null;
}

function normalizeSettings(raw: unknown): PersistedState["settings"] {
  const parsed = z.record(z.string(), z.unknown()).safeParse(raw);
  if (!parsed.success) return { ...DEFAULT_SETTINGS };
  const { openAiApiKey: _removedCredential, ...safeSettings } = parsed.data;
  return {
    ...DEFAULT_SETTINGS,
    ...safeSettings,
    openAiCredentialMode: "broker",
  } as PersistedState["settings"];
}

function normalizeProfileHistory(
  raw: unknown,
  profiles: readonly StyleProfile[],
): Record<string, StyleProfile[]> {
  const history: Record<string, StyleProfile[]> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    Object.entries(raw).forEach(([profileId, snapshots]) => {
      const idResult = z.string().uuid().safeParse(profileId);
      if (!idResult.success || !Array.isArray(snapshots)) {
        return;
      }
      const validSnapshots = snapshots
        .map((snapshot) => StyleProfileSchema.safeParse(snapshot))
        .filter(
          (result): result is { success: true; data: StyleProfile } =>
            result.success && result.data.id === profileId,
        )
        .map((result) => result.data);
      if (validSnapshots.length > 0) {
        history[profileId] = validSnapshots;
      }
    });
  }

  profiles.forEach((profile) => {
    if (!history[profile.id]) {
      history[profile.id] = [profile];
    }
  });
  return history;
}
