/**
 * Audit record and session provenance (R7, original §30–§31).
 *
 * The store holds ciphertext only. This module defines the plaintext the
 * ciphertext wraps: the provenance that says which models and versions produced
 * a run, the coverage, the issues, and the evidence hashes the exceptions rest
 * on. Persisting this is what makes a run reproducible — a reader can see why
 * every issue was presented, and a later evidence change invalidates an
 * exception built on text that has since moved.
 *
 * No credential is ever part of this record. `ProviderConnection.ts` has no
 * field capable of holding one, and neither does this.
 */

import { z } from "zod";
import {
  CONSISTENCY_STORE_VERSION,
  ConsistencyCoverageSchema,
  ConsistencyIssueSchema,
  type ConsistencyCoverage,
  type ConsistencyIssue,
  type ConsistencyReport,
} from "../contracts";

/** Default TTL for an ephemeral local store: seven days (original §30). */
export const CONSISTENCY_STORE_TTL_DAYS = 7;
export const CONSISTENCY_STORE_TTL_MS = CONSISTENCY_STORE_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Storage provenance (original §31).
 *
 * Every field is a version or an identity, never content. `expiresAt` is the
 * authoritative expiry for the audit content; the store's TTL wipe uses the
 * record's `updatedAt` plus the same TTL, so the two agree.
 */
export const ConsistencySessionProvenanceSchema = z.object({
  documentFingerprint: z.string(),
  claimGraphSchemaVersion: z.string(),
  extractionPromptVersion: z.string(),
  generalModel: z.string(),
  decisionProvider: z.string(),
  decisionModel: z.string(),
  questionSetVersion: z.string(),
  confidenceProfileVersion: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});

export type ConsistencySessionProvenance = z.infer<typeof ConsistencySessionProvenanceSchema>;

/**
 * The complete audit record for one document revision.
 *
 * `evidenceHashes` are the hashes of the evidence the issues rest on. An
 * exception is invalidated when a supporting hash changes, which is the
 * "stale evidence invalidates exceptions" rule (acceptance #31).
 */
export const ConsistencyAuditRecordSchema = z.object({
  version: z.number().int().min(1),
  revision: z.string().trim().min(1),
  provenance: ConsistencySessionProvenanceSchema,
  coverage: ConsistencyCoverageSchema,
  issues: z.array(ConsistencyIssueSchema),
  evidenceHashes: z.array(z.string()),
});

export type ConsistencyAuditRecord = z.infer<typeof ConsistencyAuditRecordSchema>;

/** The provenance a run records, with the fields the engine cannot know left blank. */
export interface ProvenanceInput {
  documentFingerprint: string;
  claimGraphSchemaVersion: string;
  extractionPromptVersion: string;
  generalModel: string;
  decisionProvider: string;
  decisionModel: string;
  questionSetVersion: string;
  confidenceProfileVersion: string;
  createdAt: string;
}

/** Build the provenance, deriving `expiresAt` from the TTL. */
export function buildProvenance(input: ProvenanceInput): ConsistencySessionProvenance {
  const created = Date.parse(input.createdAt);
  // When createdAt is unparseable, fall back to now + TTL rather than echoing
  // the unparseable string. An unparseable expiresAt would make the record
  // unreadable by isExpired and the TTL wipe.
  const expiresAt = Number.isNaN(created)
    ? new Date(Date.now() + CONSISTENCY_STORE_TTL_MS).toISOString()
    : new Date(created + CONSISTENCY_STORE_TTL_MS).toISOString();
  return ConsistencySessionProvenanceSchema.parse({ ...input, expiresAt });
}

/**
 * Build the audit record for a finished report.
 *
 * `evidenceHashes` is passed in rather than read from the report: the report
 * carries issue evidence text, not the hashes the validator proved, and the
 * caller is the only place that still holds them.
 */
export function buildAuditRecord(
  report: ConsistencyReport,
  provenance: ConsistencySessionProvenance,
  evidenceHashes: readonly string[],
): ConsistencyAuditRecord {
  return ConsistencyAuditRecordSchema.parse({
    version: CONSISTENCY_STORE_VERSION,
    revision: report.revision,
    provenance,
    coverage: report.coverage,
    issues: report.issues,
    evidenceHashes: [...evidenceHashes],
  });
}

/**
 * Whether a record has passed its TTL.
 *
 * A record with an unparseable `updatedAt` is treated as expired: a store that
 * cannot say when it was written cannot be trusted to still be current, and the
 * safe failure is a wipe.
 */
export function isExpired(updatedAt: string, nowIso: string): boolean {
  const updated = Date.parse(updatedAt);
  const now = Date.parse(nowIso);
  if (Number.isNaN(updated) || Number.isNaN(now)) return true;
  return now - updated > CONSISTENCY_STORE_TTL_MS;
}

/**
 * Whether an exception still holds against the evidence it was built on.
 *
 * An exception is invalidated when any supporting hash is missing from the
 * current set. This is the check the UI runs before showing a stored exception
 * as still valid.
 */
export function evidenceStillValid(
  storedHashes: readonly string[],
  currentHashes: readonly string[],
): boolean {
  const current = new Set(currentHashes);
  return storedHashes.every((hash) => current.has(hash));
}

export type { ConsistencyCoverage, ConsistencyIssue };
