/**
 * Host-neutral analysis context.
 *
 * A context is assembled once by the Word boundary and then consumed by pure
 * analyzers. It deliberately contains DTOs only: no Office objects, ranges, or
 * provider handles cross this boundary.
 */

import type { DocumentNode, DocumentSnapshot } from "../core/domain/DocumentSnapshot";
import type { GovernanceProfile } from "../core/domain/GovernanceProfile";
import type { StyleProfile } from "../core/domain/StyleProfile";
import type { FormattingSnapshot } from "../formatting/formattingSnapshot";

export interface AnalysisCapabilities {
  supportsInsertText: boolean;
  supportsReplaceText: boolean;
  supportsInsertParagraph: boolean;
  supportsInsertBreak: boolean;
  supportsStyles: boolean;
  supportsParagraphFormat: boolean;
  supportsCharacterFormat: boolean;
  supportsResetCharacterFormatting: boolean;
  supportsListLevel: boolean;
  supportsRevisions: boolean;
  supportsSelection: boolean;
  supportsParagraphResolution: boolean;
  supportsHighlight: boolean;
  /**
   * Whether `Office.contextMenu.requestUpdate` exists. Not whether Word renders
   * the declared menu — see the note on `WordCapabilities.supportsContextMenuApi`.
   */
  supportsContextMenuApi: boolean;
  /**
   * Whether the host serves `document.tables`.
   *
   * Part of spec §8.3. Absent from the original probe because nothing read
   * tables; declared now so a table standard on the profile produces a coverage
   * limitation rather than a silent pass. Defaults to `false` at every site
   * that builds this object, because "not probed" and "probed and absent" must
   * produce the same answer and `false` is the answer that is safe.
   */
  supportsTables: boolean;
  /** Whether the host serves header and footer collections. Spec §8.4. */
  supportsHeadersFooters: boolean;
  /** Whether the host serves section properties. Spec §8.5. */
  supportsSections: boolean;
  hostName: "Word" | "Excel" | "PowerPoint" | "unknown";
  hostVersion: string | null;
}

export interface AcquisitionDiagnostics {
  runId: string;
  acquisitionReadCount: number;
  syncCount: number;
  analyzedCharacterCount: number;
  completeDocumentCharacterCount: number;
  fullBodyReadCount: number;
  paragraphCollectionRead: boolean;
  structuralCoverage: "complete" | "partial" | "unsupported";
  /** Scopes the host would not serve. The remedy is a different Word. */
  unsupported: string[];
  /**
   * Scopes this pass did not attempt, whatever the host can do.
   *
   * Kept apart from `unsupported` because the remedy differs: a scope the policy
   * excluded, or one this acquisition has no reader for, is a setting or a missing
   * feature rather than a host limitation. `coverage.ts` reads this to avoid
   * sending the reader to a different Word for a decision ToneForge made.
   */
  notAttempted: string[];
  /**
   * Whether acquisition itself examined only part of the document.
   *
   * Widened from the literal `false` for the same reason as the coverage schema:
   * the acquisition adapter always reads the whole body, but a caller that
   * narrows the examined set afterwards reports that through the coverage
   * report, and a type that cannot say `true` pushes that lie back onto whoever
   * builds the diagnostic.
   */
  incremental: boolean;
  incrementalReason: string;
}

export interface AnalysisIdentity {
  documentId: string;
  documentVersion: string;
  contentHash: string;
  structuralHash: string;
  capturedAt: string;
  fullText: string;
  analysisText: string;
  analysisStart: number;
  analysisEnd: number;
  analysisTruncated: boolean;
}

export interface AnalysisContext {
  readonly identity: AnalysisIdentity;
  readonly text: string;
  readonly nodes: readonly DocumentNode[];
  readonly snapshot: DocumentSnapshot;
  readonly formatting: FormattingSnapshot;
  readonly profile: StyleProfile;
  readonly capabilities: AnalysisCapabilities;
  readonly policy: GovernanceProfile;
  readonly acquisition: AcquisitionDiagnostics;
}

export function createAnalysisContext(input: {
  snapshot: DocumentSnapshot;
  formatting: FormattingSnapshot;
  profile: StyleProfile;
  policy: GovernanceProfile;
  capabilities: AnalysisCapabilities;
  acquisition: AcquisitionDiagnostics;
}): AnalysisContext {
  const snapshot = input.snapshot;
  const identity: AnalysisIdentity = {
    documentId: snapshot.documentId,
    documentVersion: snapshot.versionToken,
    contentHash: snapshot.contentHash,
    structuralHash: snapshot.structuralHash,
    capturedAt: snapshot.capturedAt,
    fullText: snapshot.fullText ?? "",
    analysisText: snapshot.analysisText ?? snapshot.fullText ?? "",
    analysisStart: snapshot.analysisStart ?? 0,
    analysisEnd: snapshot.analysisEnd ?? (snapshot.analysisText ?? snapshot.fullText ?? "").length,
    analysisTruncated: snapshot.analysisTruncated ?? false,
  };
  return deepFreeze({
    identity,
    text: identity.analysisText,
    nodes: snapshot.nodes,
    snapshot,
    formatting: input.formatting,
    profile: input.profile,
    capabilities: input.capabilities,
    policy: input.policy,
    acquisition: input.acquisition,
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach((child) => deepFreeze(child));
  }
  return value;
}
