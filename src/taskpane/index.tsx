/**
 * The landing page of the one ToneForge pane.
 *
 * `semantic.html` is the *same* pane on a different page (ADR-0109), and it
 * imports `start` from `bootstrap.tsx` rather than from this file: importing this
 * module would run its own `start()` as a side effect and mount a second time,
 * which is the very duplication this arrangement exists to avoid.
 */
import { start } from "./bootstrap";

start();
