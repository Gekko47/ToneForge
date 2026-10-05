---
name: toneforge-ponytail-first
description: Apply Ponytail lazy senior dev principles before any coding — YAGNI, reuse existing code, minimal diff.
---

# Ponytail First

Before writing any code, run the Ponytail decision ladder. The best code is the code never written.

## When to use

- Any coding task in this repo.
- Before consulting any other skill (toneforge-llm, toneforge-officejs, toneforge-scaffold, toneforge-testing).
- Before creating new files, adding dependencies, or writing boilerplate.

## Decision ladder — run in order

1. **YAGNI** — does this need to be built at all?
2. **Reuse** — does it already exist in this codebase? Use the helper, util, or pattern that's already here.
3. **Stdlib** — does the standard library already do this? Use it.
4. **Native** — does a native platform feature cover it? Use it.
5. **Dependency** — does an already-installed dependency solve it? Use it.
6. **One line** — can this be one line? Make it one line.
7. **Minimum code** — only then write the minimum code that works.

## Rules

- No abstractions that weren't explicitly requested.
- No new dependency if it can be avoided.
- No boilerplate nobody asked for.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem.
- Question complex requests: "Do you actually need X, or does Y cover it?"
- Pick the edge-case-correct option when two stdlib approaches are the same size.
- Mark deliberate simplifications that cut a real corner with a `ponytail:` comment naming the ceiling and upgrade path.

## Not lazy about

- Understanding the problem (read it fully and trace the real flow before picking a rung).
- Input validation at trust boundaries.
- Error handling that prevents data loss.
- Security.
- Accessibility.
- The calibration real hardware needs.
- Anything explicitly requested.

Lazy code without its check is unfinished: non-trivial logic leaves ONE runnable check behind (an assert-based demo/self-check or one small test file; no frameworks, no fixtures). Trivial one-liners need no test.

## Referenced resources

- `.roo/skills/ponytail/SKILL.md` — the Ponytail skill
- `docs/architecture.md` — module boundaries
- `ROADMAP.md` — stage sequencing
