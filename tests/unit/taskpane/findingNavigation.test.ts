/**
 * One guard, shared by every "go to this finding" control.
 *
 * The defect this pins: each finding card called `navigateToFinding` itself,
 * and `office.run` cannot be cancelled. Clicking one card then another started
 * two host navigations and whichever finished last won, so the card that
 * reported "selected" was the one that happened to resolve last rather than the
 * one the user most recently asked for.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { sampleFinding } from "../../fixtures/sampleDocs";

const mocks = vi.hoisted(() => ({
  navigateToFinding: vi.fn(),
}));

vi.mock("../../../src/word/sourceLocator", () => ({
  navigateToFinding: mocks.navigateToFinding,
}));

import {
  goToFinding,
  reportHostMoved,
  resetFindingNavigation,
} from "../../../src/taskpane/findingNavigation";

/**
 * A host call that stays pending until the test releases it.
 *
 * `release` resolves whatever is pending *and* everything queued behind it, by
 * resolving the host immediately once released. A queue that only drains the
 * attempts present at the moment of release leaves the attempt the guard starts
 * afterwards pending forever, which reads as the guard hanging.
 */
function deferredHost(): { release: () => void; released: () => boolean } {
  let released = false;
  mocks.navigateToFinding.mockImplementation(() =>
    Promise.resolve(
      released
        ? { navigated: true, method: "offsets", message: "Selected." }
        : new Promise((resolve) =>
            resolve({ navigated: true, method: "offsets", message: "Selected." }),
          ),
    ),
  );
  return {
    release: () => {
      released = true;
    },
    released: () => released,
  };
}

describe("the shared finding-navigation guard", () => {
  beforeEach(() => {
    resetFindingNavigation();
    mocks.navigateToFinding.mockReset();
  });

  it("routes a jump through the host locator", async () => {
    mocks.navigateToFinding.mockResolvedValue({
      navigated: true,
      method: "offsets",
      message: "Selected the finding.",
    });
    const finding = sampleFinding();

    const outcome = await goToFinding(finding);

    expect(mocks.navigateToFinding).toHaveBeenCalledWith({ finding });
    expect(outcome.moved).toBe(true);
    expect(outcome.superseded).toBe(false);
    expect(outcome.message).toBe("Selected the finding.");
  });

  /*
   * The defect, stated as a test.
   *
   * Two clicks, one host. The first attempt is superseded and its caller is
   * told so, rather than being allowed to claim a selection that the second
   * request then undid.
   */
  it("supersedes the first attempt when a second is requested", async () => {
    const host = deferredHost();
    const first = sampleFinding();
    const second = sampleFinding({ id: "22222222-2222-4222-8222-222222222222" });

    const firstOutcome = goToFinding(first);
    const secondOutcome = goToFinding(second);
    host.release();

    const [a, b] = await Promise.all([firstOutcome, secondOutcome]);
    // The first caller is told it lost rather than being allowed to claim a
    // selection the second request then undid.
    expect(a.superseded).toBe(true);
    expect(b.superseded).toBe(false);
  });

  /*
   * Two attempts at the *same* finding, sequentially, are coalesced — and that
   * is the guard working, not a missing call.
   *
   * Rule 3 is deliberately different from rule 4. A repeated jump to the place
   * the document is already at must not reach the host, because `office.run`
   * cannot be cancelled and the user gains nothing from a second selection
   * change. Rule 4 is about *concurrent* attempts carrying one id, which the
   * per-attempt request id here makes unrepresentable.
   */
  it("coalesces a second jump to the finding it is already at", async () => {
    mocks.navigateToFinding.mockResolvedValue({
      navigated: true,
      method: "offsets",
      message: "Selected.",
    });
    const finding = sampleFinding();

    await goToFinding(finding);
    const second = await goToFinding(finding);

    expect(mocks.navigateToFinding).toHaveBeenCalledTimes(1);
    expect(second.moved).toBe(false);
  });

  it("reports the host moving, so the next jump is not coalesced away", async () => {
    mocks.navigateToFinding.mockResolvedValue({
      navigated: true,
      method: "offsets",
      message: "Selected.",
    });
    const finding = sampleFinding();

    await goToFinding(finding);
    // The user clicked somewhere else in the document.
    reportHostMoved();
    await goToFinding(finding);

    // Without the invalidation, rule 3 would return `alreadyAtTarget` and the
    // second jump would never reach the host.
    expect(mocks.navigateToFinding).toHaveBeenCalledTimes(2);
  });

  it("abandons in-flight work when the pane resets", async () => {
    const host = deferredHost();
    const outcome = goToFinding(sampleFinding());
    resetFindingNavigation();
    host.release();

    const result = await outcome;
    expect(result.superseded).toBe(true);
  });
});
