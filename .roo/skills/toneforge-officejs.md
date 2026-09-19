# Skill: Office.js for ToneForge

Use this skill when working with Word-specific code in `src/word/`.

## When to use

- Reading or writing document content via Office.js.
- Probing Word capabilities (Stage 01).
- Implementing the revision adapter (Stage 18).
- Debugging host compatibility issues.

## Key APIs

- `Office.run(async (context) => { ... })` — main entry point for document operations.
- `context.document.body` — document body, exposes `text` after `load("text")`.
- `context.document.getSelection()` — current selection.
- `range.insertText(text, "Replace")` — replace selection text.
- `range.insertBreak(Office.InsertBreakBehavior.Paragraph)` — insert paragraph break.
- `context.sync()` — flush queued commands to the host.

## Type declarations

Office.js types live in `src/types/office.d.ts`. Import nothing from `@types/office.js` — use the local declaration.

## Testing

`tests/setup.ts` provides a minimal `Office` mock. Use it to test `word/` modules without a live Word instance.

## Safety

- Never mutate Word directly from rules or UI. Route all mutations through `src/word/revisionAdapter.ts`.
- Always call `context.sync()` after loading properties.
- Wrap host calls in try/catch and record failures as capability flags.
