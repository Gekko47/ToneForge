/**
 * The context menu's page of the one ToneForge pane.
 *
 * **Why a second entry at all.** The context menu is a task pane command
 * (ADR-0107), so choosing it runs no JavaScript of ours — there is nothing that
 * could call `navigate("semantic-review")` inside an already-open pane. Microsoft
 * documents what does work: commands sharing a `<TaskpaneId>` keep "the pane
 * container open but the contents of the pane will be replaced with the
 * corresponding Action `SourceLocation`". **The page a command loads is the
 * instruction** (ADR-0109).
 *
 * So this is a second *page*, not a second pane: `taskpane.html` and
 * `semantic.html` share one `TaskpaneId`, one `Dashboard`, one Office runtime,
 * one session, and one selection subscription. They differ in exactly one value.
 *
 * **The text arrives for free.** Semantic Review reads the selection when it
 * mounts (ADR-0108), so the paragraph or selection the user right-clicked is
 * already on screen when the page appears — no instruction is carried, and no
 * cross-document channel is involved. That matters, because `localStorage` is
 * blocked on the host that reported the original defect (ADR-0106).
 */

import { start } from "./bootstrap";

start("semantic-review");
