# Deterministic Style Profile page — consistency and modernisation plan

**Date:** 2026-10-04 · **Revision 2** (owner answers folded in)
**Status:** Proposed — awaiting owner approval
**Supersedes:** the UX-4 editor items in
`deterministic-review-deviation-verification-and-remediation.md`, written
before the page was read end to end.

---

## 1. Owner decisions taken

| #   | Decision                                                                                 | Consequence for this plan                                                                    |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| D-a | **Build bulk-add before deleting the terminology textarea**                              | Bulk-add becomes a hard prerequisite (§5, stage B). The textarea is deleted last, not first. |
| D-b | Title-case words + sentence case belong under **Language → Capitalisation**              | Confirmed; folded into the target.                                                           |
| D-c | Headings are **global and uniform**, adopting Microsoft + Fluent, **not** page-local     | Scope grows from one page to the whole task pane. §4 is now an app-wide change.              |
| D-d | **`.tf-title` changes globally** to the ramp's Title size — no page-local override class | All nine `<h1 className="tf-title">` move together, which is the point. §4.                  |

**Status: approved.** B1–B6 and S1–S13 are authorised to implement.

---

## 2. What was found

Six defects. D-3's true cause is worse than first diagnosed — see §4.

### D-1 — Two Typography sections, one of them empty

[`ProfileEditor.tsx`](../../src/taskpane/components/ProfileEditor.tsx) renders a
`Typography` panel with eight real `Dropdown`s. Twenty lines below,
[`DeterministicStyleSections.tsx`](../../src/taskpane/components/DeterministicStyleSections.tsx)
renders a Typography **section** whose entire body is the sentence _"The
individual dash, quote and ellipsis controls are in the Typography panel above."_
A heading that leads nowhere, pointing at another panel on the same page.

**The controls are in the wrong component.** Phase 6b recorded "Typography has no
controls" and stopped there; the fix is to move them, not to leave the note.

### D-2 — Two owners for the same two fields

`House style` writes, via `buildCandidate()`:

| Field                                      | Also edited by         | Second editor's format                                         |
| ------------------------------------------ | ---------------------- | -------------------------------------------------------------- |
| `language.terminology`                     | Language → Terminology | row editor, carries `severity` / `caseSensitive` / `wholeWord` |
| `language.bannedTerms`                     | Language → Terminology | textarea, one term per line                                    |
| `houseStyle.capitalization.titleCaseWords` | —                      | textarea                                                       |
| `houseStyle.capitalization.sentenceCase`   | —                      | toggle                                                         |

The first two have a **second editor on the same page**, and the textarea form
is lossy by design — `foldTerminology()` reconstructs the flags it cannot carry.
This is ND-2 reproduced in the UI: the schema fix (Phase 2) did not reach the
editor.

### D-3 — Inverted hierarchy on the profile page

| Element                              | Declared               | Microsoft ramp  |
| ------------------------------------ | ---------------------- | --------------- |
| `<h1>` "Deterministic Style Profile" | **14px** (`.tf-title`) | Title — 21px    |
| `<h3>` "Typography" / "House style"  | **20px** (inline)      | Subtitle — 17px |

The h1 is six pixels smaller than its own h3. `20px` appears nowhere else.

### D-4 — Fourteen font sizes across three units

`taskpane.css` mixes px, rem and em: `12, 13, 14, 16, 0.7rem, 0.75rem, 0.8rem,
0.85rem, 0.9rem, 0.95rem, 0.8em, 0.85em, 0.9em, 1.1em`. The rem values resolve to
~11.2–15.2px — **none on the 4px grid, none on the ramp** Microsoft specifies
(and names only six of).

### D-5 — Inline style objects bypass the token system

`sectionStyle`, `sectionHeadingStyle`, `gridStyle`, `buttonStyle` in
`ProfileEditor`. The lint guard bans **colour literals only** — `fontSize: 20` is
not a colour, so it passed. The guard has a real gap.

### D-6 — Four sections and two panels in a 445px pane

Microsoft documents the **Word task pane as 329 × 445 px**. Typography — the one
with eight controls — is one of only two regions that never collapse.

---

## 3. Target page structure

```
Profile page
├── Header            breadcrumb · h1 (21px) · intro
├── Record history    ProfileRecordSection          (already collapsible)
├── Profile identity  name · validate · VersionDiff · save
└── Standards         DeterministicStyleSections
    ├── Language      Terminology · Capitalisation · Abbreviations
    │                 Numbers · Dates · Currency · Units        (7, done)
    ├── Typography    Dashes · Quotes · Ellipsis
    │                 Numbers & separators
    ├── Formatting    Body · Lists · Tables · Headers · Page setup
    └── Structure     Heading hierarchy · structural targets
```

**Typography moves into `DeterministicStyleSections`**, which already owns the
collapsible frame and the host-capability marking. D-1 dies by construction.

**House style dissolves** (D-b):

| Control               | Disposition                                         |
| --------------------- | --------------------------------------------------- |
| Preferred terminology | Deleted — duplicate owner (D-2)                     |
| Banned terms          | Deleted — duplicate owner (D-2)                     |
| Title-case words      | → Language → Capitalisation                         |
| Sentence case         | → Language → Capitalisation                         |
| Spelling variant      | Stays absent — no rule reads it (existing decision) |

> **Ownership verified (D2).** `decimalSeparator` and `thousandsSeparator` are
> declared **only** in `typography`
> ([`StyleProfile.ts:62`](../../src/core/domain/StyleProfile.ts:62)); the language
> `numbers` schema carries no separator fields by design
> ([:248`](../../src/core/domain/StyleProfile.ts:248)). They go under
> **Typography → Numbers & separators**, _not_ Language → Numbers. Moving them
> the other way reopens D2.

---

## 4. The heading ramp — app-wide, and the real cause

D-3 is a symptom. The cause is that **headings are mostly unstyled**, so they
fall back to the user agent:

| Pattern                                        | Count | Renders at                                |
| ---------------------------------------------- | ----- | ----------------------------------------- |
| `<h2>` with **no className**                   | ~25   | UA default (≈24px, UA margins)            |
| `<h1 className="tf-title">`                    | 9     | 14px                                      |
| `<h3 className="tf-sub">`                      | 3     | 14px — a **body** class used as a heading |
| `<h4 className="tf-subheading">` / bare `<h4>` | 5     | mixed                                     |
| `<h3 style={{fontSize:20}}>`                   | 2     | 20px inline                               |

So a page can show a 14px "h1", a 24px UA "h2" and a 20px "h3" in that order.
That is the inconsistency being reported — it is not primarily the profile page.

### The ramp

One rule per level, in the stylesheet, so a bare `<h2>` stops falling back:

| Level      | Size     | Weight      | Role                           |
| ---------- | -------- | ----------- | ------------------------------ |
| `h1`       | **21px** | Segoe Light | page title — Title             |
| `h2`       | **17px** | Semibold    | section — Subtitle             |
| `h3`       | **14px** | Semibold    | sub-section — Body, emphasised |
| `h4`       | **12px** | Semibold    | legend / label — Caption       |
| body       | 14px     | Regular     | —                              |
| caption    | 12px     | Regular     | hints, secondary               |
| annotation | 11px     | Regular     | badges, fieldset legends       |

Exposed as `--tf-font-title` … `--tf-font-annotation` and `--tf-space-*` on the
4px grid, so both themes read the same tokens.

### The brand lockup — uniform now, opt-out only if review says so

`TaskPaneHeader` and `App.tsx`'s loading `<p>` both carry `tf-title`, so **D-d
moves them too**. That is deliberate: nine headings moving together is the
uniformity being asked for, and special-casing two of them on a prediction
about how 21px will look would pre-empt the visual review with a guess.

It is recorded as a **known open question**, not a silent decision: at 21px the
product name sits in the header of every page, and Microsoft places branding in
a footer brand bar rather than as a page heading. If the visual review finds it
dominating, the remedy is one explicit opt-out class on the lockup — a two-line
change taken **after** someone has looked at it, rather than before.

### One genuine exception

- **`.tf-sub` used on `<h3>`** in Home, FindingsList and
  SemanticRewriteComparison. Those become real `h3`s; a body class is not doing
  a heading's job, and this is a correctness fix rather than a styling choice.

---

## 5. Stages

**B — Prerequisite: bulk-add to the terminology row editor** _(D-a)_ — **COMPLETE**

1. A "Add many terms" disclosure beside the row editor, reusing the existing
   [`terminologyText.ts`](../../src/taskpane/settings/terminologyText.ts)
   `parseTerminology` / `formatTerminology` — **already the single shared parser**,
   so this is reuse, not a third implementation. **Done.**
2. Paste `term: replacement` lines → preview count → Apply adds rows, each with
   default `severity: "advisory"`, `caseSensitive: false`, `wholeWord: true` —
   the same defaults the "Add term" button uses. **Done**; the count is stated
   before anything is written, in a `role="status"` sentence that tracks typing.
3. Existing rows are matched on term, not duplicated; the paste is additive.
   **Done**, case-sensitively on the trimmed source, and a skip is _named_ rather
   than silent.
4. Parse errors reported per line, using the existing `TermNouns` wording. **Done.**
5. Tests: **Done** — 17 on the pure module, 10 on the component.

**Two deviations from the plan above, both recorded rather than made quietly.**

- The shared logic went into a **pure module**
  ([`terminologyRows.ts`](../../src/taskpane/terminologyRows.ts)) rather than the
  component, so it is tested without jsdom. The local `nextTermId` in
  `DeterministicStyleSections` was deleted and the single-add button now calls the
  same factory — so the button and the paste **cannot** produce different rules.
  The plan only asked for "the same defaults"; sharing one factory makes that
  structural instead of a promise.
- A malformed line **refuses the whole paste**, where the plan said the rest would
  still apply. A paste with one unusable line is far likelier a formatting mistake
  than a deliberate exclusion, and applying the rest hides the mistake.

**S — Structural** (order matters; each step leaves the page shippable)

| #   | Step                                                                     | Closes                 |
| --- | ------------------------------------------------------------------------ | ---------------------- |
| S1  | Move the eight Typography `Dropdown`s into `DeterministicStyleSections`  | D-1                    |
| S2  | Split Typography into Dashes / Quotes / Ellipsis / Numbers & separators  | D-1                    |
| S3  | Move title-case words + sentence case into Language → Capitalisation     | D-2                    |
| S4  | Delete the House style panel and the terminology textarea                | D-2                    |
| S5  | Reduce `ProfileEditor` to identity + validation + version + save         | D-2, D-5               |
| S6  | Remove the inline style objects; shared collapsible panel class          | D-5                    |
| S7  | App-wide heading ramp; remove UA fallback                                | D-3, D-4 (the big one) |
| S8  | 3 `<h3>` stop misusing `.tf-sub`; brand lockup follows `.tf-title` (D-d) | D-3                    |
| S9  | Type tokens as CSS custom properties; 4px spacing grid                   | D-4                    |
| S10 | Extend the lint guard past colour literals to hard-coded `font-size`     | D-5                    |

S7 is last because the heading ramp is app-wide: doing it before the content
moves means restyling elements that are about to be deleted.

**V — Verification**

- format · typecheck · lint · full suite after each stage
- Tests: one owner per field (no field edited from two places); Typography has
  controls; House style gone; terminology round-trip preserved; heading levels
  assert the ramp, not the mechanism
- ADR, decision log, plan log updated
- Manual-verification item: both themes, 329px, keyboard traversal

---

## 6. Risks worth naming

- **S7 touches every page.** Highest blast radius in the plan; it needs its own
  review pass, not a drive-by.
- **`h1` at 21px on eight pages** changes first impressions everywhere. That is
  what was asked for; it should not be discovered at the end.
- **Bulk-add (B) is new product surface**, not a refactor. It gets its own
  tests and its own ADR.
- jsdom computes no styles — every size and spacing outcome is source-level only.

## 7. Not claimed

No automated run establishes how any of this looks. The visual result needs a
human in Word, both themes, at 329px — it joins the manual checklist in
[`manual-verification.md`](../../docs/manual-verification.md).
