# ToneForge — Accessibility Checklist

## Keyboard navigation

- All interactive controls are native HTML `<button>` / `<a>` elements — keyboard accessible by default.
- Tab order follows DOM order; no `tabindex` overrides that break natural flow.
- Focus indicators are visible (Fluent UI theme tokens provide them).

## Screen reader

- All dynamic regions have `aria-live="polite"` or `role="alert"` for error states.
- Loading states announce themselves (`aria-live="polite"`).
- Icons used decoratively are hidden from AT (`aria-hidden="true"`).
- Card headings use semantic `<h1>`–`<h3>`.

## Motion

- `src/taskpane/theme.tsx` respects `prefers-reduced-motion`. No auto-running animations when reduced motion is set.

## Contrast

- Fluent UI theme tokens meet WCAG AA contrast ratios.
- Error text uses `#d13438` on white background — verified AA.

## Forms

- All inputs have associated `<label>` or `aria-labelledby`.
- Error messages are programmatically associated with the fields they describe.

## Reformat and pending-change readiness

- Safe reformat and pending-change Apply controls expose disabled reasons through
  `aria-describedby` and announce stale, conflict, approval, precondition, host,
  tracking, and coverage states with polite status regions.
- Per-change previews use semantic tables and explicit text when before/after
  values are unavailable; absence is never rendered as a successful preview.
- Navigation retains initial focus, traps Tab while the modal drawer is open,
  closes on Escape, and restores focus to the navigation trigger.

## Verification

Run `npm run lint` — the `jsx-a11y` plugin flags violations automatically. The
component suite covers disabled reasons, status announcements, Escape/focus
restoration, and keyboard focus containment. Live screen-reader, browser, ribbon,
and Word-host evidence remains a release gate and is not claimed by unit tests.
