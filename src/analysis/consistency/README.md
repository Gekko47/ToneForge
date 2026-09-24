# Content Consistency Review — Reserved Phase H Seam

This directory is intentionally documentation-only in the A–G refactor. It is
not an analysis engine, contains no findings, and must not be imported by live
governance, observer, AI review, or mutation code.

Phase H may add content-consistency review only after the core release is
accepted, the full-document privacy review is approved, and explicit user
consent is designed. The future engine will consume stable `DocumentNode`
source paths and `Finding.nodeIds`, emit coverage-gated runs, and remain
separate from spot review and the live typing observer.

No C1–C10 implementation is present in the current release.
