export { probeWordCapabilities, type WordCapabilities } from "./capabilityProbe";
export {
  getDocumentSnapshot,
  getSelectionText,
  getSelectedParagraphText,
  getStructuredSnapshot,
  resolveSourceRange,
  hashDocument,
  type DocumentSnapshot,
  type ParagraphRange,
  splitParagraphRanges,
} from "./documentReader";
export { getFormattingSnapshot, type FormattingReadOptions } from "./formattingReader";
export { applyChangePlan, validatePlanBeforeApply, type RevisionResult } from "./revisionAdapter";
export {
  DocumentSnapshotSchema,
  type DocumentSnapshot as DocumentSnapshotSchemaType,
  type DocumentNode,
  type SourceRange,
} from "../core/domain/DocumentSnapshot";
