/**
 * Reading the task pane's visibility, on a host that may not offer it.
 *
 * **Why this module exists.** `Office.addin` is the surface that tells a pane it
 * has been shown or hidden, and the Semantic Review page needs that: the context
 * menu is a **task pane command** (ADR-0107), so no JavaScript of ours runs when
 * the user picks it and there is nothing to tell an already-open pane which page
 * to show. Its visibility change is the only signal that fires.
 *
 * It exists as a module rather than a cast at each call site because
 * `types/office.d.ts` declares `const Office` *inside* `namespace Office`, so the
 * expression `Office.addin` resolves against the namespace — which has no such
 * member — rather than against the value. That is a quirk of the file's own shape,
 * and it is the reason every previous call to this surface in this repository was
 * a hand-rolled cast. The cast now lives here, once, against a **declared** type
 * rather than an invented one, which is what ADR-0084 asks for.
 *
 * **Absent is normal.** These members exist only on a shared runtime
 * (SharedRuntime 1.1). A host without one has no `addin` object at all, so every
 * function here returns `false` rather than throwing, and the caller's fallback is
 * the manual control it already had.
 */

/**
 * The declared surface, reached without asserting a shape we invented.
 *
 * `Office.Addin` is a member of the **global** `Office` namespace declared in
 * `types/office.d.ts`, so it is referenced unqualified. The alternative \u2014 an
 * invented inline shape at each call site \u2014 is exactly what ADR-0084 calls a
 * widened declaration: it makes the type system agree with something the host
 * does not do, and nothing then checks the two apart.
 */
interface OfficeWithAddin {
  addin?: Office.Addin;
}

function currentAddin(): Office.Addin | null {
  try {
    const office = (globalThis as unknown as { Office?: OfficeWithAddin }).Office;
    return typeof office?.addin === "object" && office.addin !== null ? office.addin : null;
  } catch {
    return null;
  }
}

/**
 * Subscribe to pane show/hide, or report that this host cannot.
 *
 * Returns a deregister function, or `null` when there is nothing to deregister
 * because the host has no such event. The caller must treat `null` as a designed
 * outcome: the page still reads the selection when it mounts, and the manual
 * control is still there.
 *
 * The returned function is asynchronous because Microsoft's is — it resolves once
 * the host has actually removed the handler — so a caller that awaits teardown
 * gets a real answer rather than a hopeful one.
 */
export async function watchTaskpaneVisibility(
  onVisible: () => void,
): Promise<(() => Promise<void>) | null> {
  const addin = currentAddin();
  const subscribe = addin?.onVisibilityModeChanged;
  if (typeof subscribe !== "function") return null;

  try {
    return await subscribe.call(addin, (message: Office.VisibilityModeChangedMessage) => {
      // Only "shown" is an arrival. "Hidden" is the user closing the pane, and
      // reading the document then would be work nobody asked for.
      if (message.visibilityMode !== "Taskpane") return;
      onVisible();
    });
  } catch {
    // A host that refuses the subscription is a host without the shared runtime.
    return null;
  }
}
