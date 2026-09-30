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
import { ProviderConnectionSchema, type ProviderConnection } from "../domain/ProviderConnection";
import {
  IgnoredFindingSchema,
  ReviewedFindingSchema,
  type IgnoredFinding,
  type ReviewedFinding,
} from "../domain/Finding";
import { DeterministicReviewSessionSchema } from "../domain/ReviewSession";
import { type PersistedState } from "./persistence";

export const CURRENT_STATE_VERSION = 13;

const DEFAULT_SETTINGS: PersistedState["settings"] = {
  llmProvider: "mock",
  openAiCredentialMode: "broker",
  consistencyReviewConsent: false,
  semanticOptIn: false,
  autoScan: true,
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
    case 7:
      return migrateV7ToV8(obj);
    case 8:
      return migrateV8ToV9(obj);
    case 9:
      return migrateV9ToV10(obj);
    case 10:
      return migrateV10ToV11(obj);
    case 11:
      return migrateV11ToV12(obj);
    case 12:
      return migrateV12ToV13(obj);
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
    semanticProfileRecords: {},
    activeSemanticProfileId: null,
    ignoredFindings: [],
    reviewedFindings: [],
    deterministicReviewSession: null,
    governanceProfiles: DEFAULT_GOVERNANCE_PROFILES,
    governanceHistory: DEFAULT_GOVERNANCE_HISTORY,
    activeGovernanceProfileId: null,
    settings: { ...DEFAULT_SETTINGS },
    providerConnections: {},
  };
}

/**
 * v12 -> v13: add the review session, starting empty.
 *
 * **No back-migration, deliberately.** A v12 store has `reviewedFindings` —
 * durable "the user has seen this" records — but it has no session and no
 * identity those records were ever bound to. Promoting them to approvals would
 * mean asserting a document revision, a profile revision, a governance revision
 * and a coverage fingerprint that were never recorded, and then applying a
 * correction to a document on the strength of a guess about which document it
 * was. That is a fabricated consent, which is the one failure worse than losing
 * a convenience. The user's decision on this point was explicit: invalidate
 * wholesale, carry nothing, no users to lose anything for.
 *
 * So the session starts `null` — "no review has been started" — which is also
 * distinguishable from an empty session, so the pane can say why the list is
 * empty rather than implying approvals were discarded.
 */
function migrateV12ToV13(obj: Record<string, unknown>): PersistedState {
  const current = readCurrentState(obj);
  return { ...current, version: CURRENT_STATE_VERSION, deterministicReviewSession: null };
}

/**
 * v11 -> v12: give reviewed findings a real home in the store.
 *
 * Reviewed decisions used to live in
 * `localStorage["ToneForge.ReviewedFindingFingerprints.v1"]` as a bare set of
 * review keys, outside this schema entirely. That has two consequences this
 * migration fixes:
 *
 * 1. The write never went through `saveState`, so it never notified subscribers.
 *    The pane re-rendered because unrelated state happened to change, which is
 *    why reviewed items reached Pending Changes only sometimes and why the only
 *    reliable recovery was pressing Re-scan.
 * 2. The set had no room to record *what* was decided. A review made before any
 *    plan existed was indistinguishable from no review at all.
 *
 * **The old keys are deliberately not carried across.** They are
 * fingerprint-plus-offset strings with no document identity, so there is no way
 * to prove one belongs to the document now open — and ToneForge has no users, so
 * there is nothing to preserve. Carrying them onto an arbitrary document would
 * be a fabricated consent, which is the one failure mode worse than losing a
 * convenience.
 *
 * Ignored findings keep their rows, but each is re-keyed onto the occurrence
 * identity the pane now matches on, so two hits of the same rule stop collapsing
 * into one row.
 */
function migrateV11ToV12(obj: Record<string, unknown>): PersistedState {
  const current = readCurrentState(obj);
  return {
    ...current,
    version: CURRENT_STATE_VERSION,
    ignoredFindings: rekeyIgnoredFindings(current.ignoredFindings),
    reviewedFindings: [],
  };
}

/**
 * Give every stored ignore its occurrence key.
 *
 * A row written before v12 has an empty key, so the key is derived from the
 * fingerprint, node set, and range the row already carries. Two rows that derive
 * the same key are genuinely the same occurrence — a re-detected finding the user
 * had already dismissed — so the newest wins rather than both surviving as
 * duplicates.
 */
function rekeyIgnoredFindings(entries: readonly IgnoredFinding[]): IgnoredFinding[] {
  const byOccurrence = new Map<string, IgnoredFinding>();
  entries.forEach((entry) => {
    const key =
      entry.occurrenceKey.length > 0
        ? entry.occurrenceKey
        : [
            entry.fingerprint,
            [...entry.nodeIds].sort().join(","),
            entry.range.start,
            entry.range.end,
          ].join("@");
    byOccurrence.set(key, { ...entry, occurrenceKey: key });
  });
  return Array.from(byOccurrence.values());
}

/**
 * v10 -> v11: split the profile namespaces and add the auto-scan and ignore-list
 * settings. Defaults only — no data is copied or moved.
 *
 * The v11 schema adds a `kind` to every profile and record, a second map for
 * semantic profiles, and an ignore list keyed by fingerprint. All four are
 * additive, and a v10 record is by definition a deterministic one, so reading it
 * through the current shape produces the correct result: `kind` defaults to
 * `"deterministic"`, the semantic map starts empty, and `autoScan` starts true,
 * which is the behaviour v10 already had.
 *
 * Nothing is extracted into a semantic record. The earlier plan copied each
 * profile's `semantic` block across, and that step was **deliberately dropped**:
 * ToneForge has no users yet, so there is no learned style to preserve, and a
 * copy would fabricate a profile the user never created. A user who runs Learn
 * Style creates the first semantic profile for real.
 */
function migrateV10ToV11(obj: Record<string, unknown>): PersistedState {
  return readCurrentState(obj);
}

/**
 * v9 -> v10: drop three settings that changed nothing.
 *
 * `spotReviewConsent` and `fullDocumentReviewConsent` gated the Phase D and
 * Phase E review engines, which no longer exist (ADR-0059). `telemetryDisabled`
 * gated an analytics endpoint that is not configured in this release. All three
 * were persisted and, for the two consents, carried in the settings draft, so a
 * user could see a permission that gated nothing.
 *
 * `consistencyReviewConsent` is carried across **exactly**, never derived from
 * either removed consent: a user who agreed to the consistency engine agreed to
 * that specifically, and inheriting a decision from a permission that is being
 * deleted would be inventing consent (ADR-0052).
 */
function migrateV9ToV10(obj: Record<string, unknown>): PersistedState {
  // `readCurrentState` reads the current shape, and `normalizeSettings` rebuilds
  // settings from an explicit field list rather than spreading the stored
  // object, so the three dropped fields simply do not survive the read. Nothing
  // else changes: every setting v9 carried that still means something is
  // preserved, and `consistencyReviewConsent` is re-derived from the stored
  // strict boolean rather than from either removed consent.
  return readCurrentState(obj);
}

/**
 * v8 -> v9: add the consistency engine's own consent, switched off.
 *
 * Every other setting is carried across untouched. The one new field is set to
 * `false` rather than being derived from any existing consent, because the whole
 * point of a third, separate consent is that it cannot be inherited: a v8 user
 * agreed to whatever v8 asked, and v8 never asked this.
 */
function migrateV8ToV9(obj: Record<string, unknown>): PersistedState {
  const current = readCurrentState(obj);
  return {
    ...current,
    settings: { ...current.settings, consistencyReviewConsent: false },
  };
}

/**
 * v7 -> v8: adopt the provider-neutral connection record.
 *
 * v7 persisted a provider name plus two OpenAI-shaped fields. v8 keeps those
 * fields so the local development path is not broken, and additionally derives
 * a connection from them when one is configured, so an existing OpenAI setup
 * becomes a first-class connection without re-entering anything. Consent is
 * carried across untouched: a migration must never revoke a user's decision.
 */
function migrateV7ToV8(obj: Record<string, unknown>): PersistedState {
  const current = readCurrentState(obj);
  return { ...current, providerConnections: deriveConnectionsFromV7(obj.settings) };
}

/**
 * Build a connection from the v7 provider settings when one is configured.
 *
 * Returns an empty map when the provider was the offline mock, because there is
 * no connection to describe. Only a loopback origin is accepted, so a stored
 * production URL cannot become a trusted connection through migration.
 */
function deriveConnectionsFromV7(raw: unknown): PersistedState["providerConnections"] {
  const parsed = z.record(z.string(), z.unknown()).safeParse(raw);
  if (!parsed.success) return {};
  const settings = parsed.data;
  const provider = settings.llmProvider;
  if (provider !== "openai" && provider !== "anthropic" && provider !== "openrouter") {
    return {};
  }
  const origin = typeof settings.openAiBaseUrl === "string" ? settings.openAiBaseUrl.trim() : "";
  if (origin.length === 0) return {};
  const normalized = normalizeLegacyOrigin(origin);
  if (!normalized) return {};

  const connection = ProviderConnectionSchema.safeParse({
    connectionId: `migrated:${provider}:${normalized}`,
    provider,
    authMode: provider === "openrouter" ? "brokerApiKey" : "deploymentManaged",
    status: "connected",
    baseOrigin: { origin: normalized, classification: "loopbackDevelopment" },
    ...(typeof settings.openAiModel === "string" && settings.openAiModel.length > 0
      ? { selectedModel: settings.openAiModel }
      : {}),
  });
  return connection.success ? { [provider]: connection.data } : {};
}

/** Accept only a loopback origin from legacy settings. */
function normalizeLegacyOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname === "::1";
    if (!loopback || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * Keep only well-formed connection records, and only those whose key matches
 * the record's own provider. A record filed under the wrong provider would let
 * the registry construct an adapter for a provider the user did not select.
 */
function normalizeProviderConnections(raw: unknown): PersistedState["providerConnections"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: PersistedState["providerConnections"] = {};
  for (const [provider, connection] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = ProviderConnectionSchema.safeParse(connection);
    if (parsed.success && parsed.data.provider === provider) {
      result[provider as ProviderConnection["provider"]] = parsed.data;
    }
  }
  return result;
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
    // A legacy record predates the split, so it is a deterministic one. The
    // semantic namespace starts empty: there is no learned style to recover
    // from a legacy blob, and inventing a profile the user never made would be
    // worse than an empty tab they can fill.
    semanticProfileRecords: {},
    activeSemanticProfileId: null,
    ignoredFindings: normalizeIgnoredFindings(obj.ignoredFindings),
    reviewedFindings: normalizeReviewedFindings(obj.reviewedFindings),
    deterministicReviewSession: normalizeReviewSession(obj.deterministicReviewSession),
    governanceProfiles: normalizeGovernanceProfiles(obj.governanceProfiles),
    governanceHistory: normalizeGovernanceHistory(obj.governanceHistory, obj.governanceProfiles),
    activeGovernanceProfileId: normalizeActiveGovernanceProfileId(obj.activeGovernanceProfileId),
    settings: normalizeSettings(obj.settings),
    providerConnections: normalizeProviderConnections(obj.providerConnections),
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
    semanticProfileRecords: {},
    activeSemanticProfileId: null,
    ignoredFindings: [],
    reviewedFindings: [],
    deterministicReviewSession: null,
    activeProfileId,
    governanceProfiles,
    governanceHistory: normalizeGovernanceHistory(obj.governanceHistory, governanceProfiles),
    // Pre-v3 state had no governance id, so the active style profile is the
    // only governance policy that can have been in force.
    activeGovernanceProfileId:
      normalizeActiveGovernanceProfileId(obj.activeGovernanceProfileId) ?? activeProfileId,
    settings: normalizeSettings(obj.settings),
    // Pre-v8 state predates provider connections entirely, so there is nothing
    // to derive; the settings themselves still migrate through normalizeSettings.
    providerConnections: {},
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

/**
 * Recover the ignored-findings list from a current-version store.
 *
 * This was hardcoded to `[]`, which meant every load discarded the list. The
 * write landed in the store and the read threw it away, so the Ignore button
 * appeared to do nothing and the ignored list never rendered — a silent,
 * total loss of a user decision on every single reload.
 *
 * Entries are validated individually rather than as a set, so one malformed
 * row cannot cost the user the rest of their ignores.
 *
 * **Collapsed on the occurrence key, not the fingerprint.** Collapsing on the
 * fingerprint was the defect: a fingerprint identifies a *rule*, so a store
 * holding two ignored em dashes could only keep one, and the load silently
 * un-ignored the other. Two hits of one rule are two rows.
 */
function normalizeIgnoredFindings(raw: unknown): IgnoredFinding[] {
  if (!Array.isArray(raw)) return [];
  const byOccurrence = new Map<string, IgnoredFinding>();
  raw.forEach((entry) => {
    const parsed = IgnoredFindingSchema.safeParse(entry);
    if (!parsed.success) return;
    const data = parsed.data;
    const key = data.occurrenceKey.length > 0 ? data.occurrenceKey : occurrenceKeyOf(data);
    byOccurrence.set(key, { ...data, occurrenceKey: key });
  });
  return Array.from(byOccurrence.values()).sort((a, b) => a.ignoredAt.localeCompare(b.ignoredAt));
}

function occurrenceKeyOf(entry: IgnoredFinding): string {
  return [
    entry.fingerprint,
    [...entry.nodeIds].sort().join(","),
    entry.range.start,
    entry.range.end,
  ].join("@");
}

/**
 * Recover the review session from a current-version store.
 *
 * Validated as a whole rather than field by field: a session whose identity does
 * not parse is a session whose decisions cannot be bound to anything, and the
 * honest reading of that is "no session" rather than a partially reconstructed
 * one whose approvals apply to an identity ToneForge had to invent.
 */
function normalizeReviewSession(raw: unknown): PersistedState["deterministicReviewSession"] {
  if (raw === null || raw === undefined) return null;
  const parsed = DeterministicReviewSessionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Recover reviewed decisions from a current-version store.
 *
 * Validated per row so one malformed decision cannot cost the rest, and
 * collapsed on identity so re-reviewing the same occurrence leaves one decision
 * rather than a growing list of near-duplicates. The newest wins, because the
 * latest decision is the one the user actually made.
 */
function normalizeReviewedFindings(raw: unknown): ReviewedFinding[] {
  if (!Array.isArray(raw)) return [];
  const byIdentity = new Map<string, ReviewedFinding>();
  raw.forEach((entry) => {
    const parsed = ReviewedFindingSchema.safeParse(entry);
    if (parsed.success) byIdentity.set(parsed.data.identity, parsed.data);
  });
  return Array.from(byIdentity.values()).sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
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

/**
 * Rebuild settings from an explicit field list rather than spreading the stored
 * object.
 *
 * A spread is what kept the retired v9 fields alive: every key the user had ever
 * stored rode through every later migration untouched, so removing a field from
 * the schema did not remove it from anybody's data (ADR-0059, ADR-0060). Naming
 * each surviving key is the only version of this function where a schema change
 * actually takes effect, and it drops the legacy `openAiApiKey` for free.
 */
function normalizeSettings(raw: unknown): PersistedState["settings"] {
  const parsed = z.record(z.string(), z.unknown()).safeParse(raw);
  if (!parsed.success) return { ...DEFAULT_SETTINGS };
  const stored = parsed.data;
  const settings: PersistedState["settings"] = {
    ...DEFAULT_SETTINGS,
    openAiCredentialMode: "broker",
    // An unrecognised provider must fail closed to the offline stub rather
    // than be described as though it were a usable remote one.
    llmProvider: isProviderId(stored.llmProvider)
      ? stored.llmProvider
      : DEFAULT_SETTINGS.llmProvider,
    // Consent flags are re-derived from strict booleans rather than spread
    // through. Everything else here is a preference and a wrong value is merely
    // wrong; a consent flag gates whether raw document text leaves the add-in, so
    // a stored `"yes"` or `1` must read as a refusal rather than as permission.
    // Anything that is not literally `true` becomes `false`.
    consistencyReviewConsent: stored.consistencyReviewConsent === true,
    semanticOptIn: stored.semanticOptIn === true,
    // A stored `false` is a real choice — the user turned auto-scanning off —
    // so this cannot be `stored.autoScan !== false`, which would turn it back
    // on. Anything other than a strict `false` keeps the default.
    autoScan: stored.autoScan === false ? false : DEFAULT_SETTINGS.autoScan,
  };
  if (typeof stored.openAiBaseUrl === "string" && stored.openAiBaseUrl.length > 0) {
    settings.openAiBaseUrl = stored.openAiBaseUrl;
  }
  if (typeof stored.openAiModel === "string" && stored.openAiModel.length > 0) {
    settings.openAiModel = stored.openAiModel;
  }
  return settings;
}

function isProviderId(value: unknown): value is PersistedState["settings"]["llmProvider"] {
  return value === "openai" || value === "anthropic" || value === "openrouter" || value === "mock";
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
