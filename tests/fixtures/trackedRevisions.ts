/**
 * Shared tracked-revision fixtures for the inspection reader, the overlap
 * matcher, and the adapter tests.
 *
 * These are plain `TrackedRevision` objects — the shape the inspection reader
 * returns and the overlap matcher consumes. They are not Office doubles.
 */

import type { TrackedRevision } from "../../src/core/domain";

export const TONE_FORGE_REVISION: TrackedRevision = {
  index: 0,
  type: "Added",
  author: "ToneForge",
  date: "2026-10-13T10:00:00Z",
  text: "corrected text",
  range: { start: 10, end: 24 },
  target: { kind: "paragraph", index: 0, nodeId: "p1" },
};

export const FOREIGN_REVISION: TrackedRevision = {
  index: 1,
  type: "Added",
  author: "Alice",
  date: "2026-10-13T09:00:00Z",
  text: "alice's edit",
  range: { start: 30, end: 41 },
  target: { kind: "paragraph", index: 1, nodeId: "p2" },
};

export const UNRESOLVED_REVISION: TrackedRevision = {
  index: 2,
  type: "Added",
  author: "Bob",
  date: null,
  text: "bob's edit",
  range: null,
  target: { kind: "paragraph", index: 2, nodeId: "p3" },
};

export const DELETED_REVISION: TrackedRevision = {
  index: 3,
  type: "Deleted",
  author: "ToneForge",
  date: "2026-10-13T10:00:00Z",
  text: "removed text",
  range: { start: 50, end: 61 },
  target: { kind: "paragraph", index: 3, nodeId: "p4" },
};

export const ALL_REVISIONS: TrackedRevision[] = [
  TONE_FORGE_REVISION,
  FOREIGN_REVISION,
  UNRESOLVED_REVISION,
  DELETED_REVISION,
];
