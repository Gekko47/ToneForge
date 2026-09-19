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

## Verification

Run `npm run lint` — the `jsx-a11y` plugin flags violations automatically.
