/**
 * Ribbon command entry point. Minimal stub wired to the taskpane.
 */

import { runInWord } from "../shared/office/officeHelpers";

export async function openTaskpane(): Promise<void> {
  try {
    await runInWord(async (context) => {
      context.document.getSelection().insertText("", "Replace");
    });
  } catch {
    // Commands may run outside a document; ignore errors.
  }
}

export default openTaskpane;
