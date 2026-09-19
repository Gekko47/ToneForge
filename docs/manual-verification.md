# ToneForge — Manual Word Verification (Stage 27)

This file records the host matrix results for Stage 27. **Status: PENDING — not yet executed.**

## Host matrix

| Host                     | Version | Browser/Engine   | Sideload OK | Taskpane renders | Probe passes | Notes |
| ------------------------ | ------- | ---------------- | ----------- | ---------------- | ------------ | ----- |
| Word on the web (Chrome) | —       | Chrome           | ⬜          | ⬜               | ⬜           |       |
| Word on the web (Edge)   | —       | Edge             | ⬜          | ⬜               | ⬜           |       |
| Word on Windows          | —       | WinEdge/Chromium | ⬜          | ⬜               | ⬜           |       |
| Word on Mac              | —       | Safari/WebKit    | ⬜          | ⬜               | ⬜           |       |

## Probe checklist

- [ ] `probeWordCapabilities()` returns `supportsInsertText: true`
- [ ] `supportsReplaceText: true`
- [ ] `supportsInsertParagraph: true`
- [ ] `supportsInsertBreak: true`
- [ ] `supportsStyles: true`
- [ ] `supportsRevisions: true` (or documented limitation)
- [ ] `hostName` is `"Word"`

## Procedure

1. Build the release artifact: `npm run build`
2. Sideload into each host per `docs/onboarding.md`
3. Open a test document
4. Run the capability probe via the taskpane
5. Record results above and in `docs/project-state.md`

## Known limitations

_None yet — fill in as discovered._
