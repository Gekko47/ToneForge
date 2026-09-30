import { describe, expect, it, vi, afterEach } from "vitest";
import {
  semanticButtonEnabled,
  syncSemanticRibbon,
  SEMANTIC_RIBBON_CONTROL,
  SEMANTIC_RIBBON_GROUP,
} from "../../../src/commands/ribbonState";

function setOffice(value: unknown): void {
  (globalThis as { Office?: unknown }).Office = value;
}

afterEach(() => {
  setOffice(undefined);
  vi.restoreAllMocks();
});

describe("semanticButtonEnabled", () => {
  it("is off with no profile, because there is nothing to match a rewrite against", () => {
    expect(semanticButtonEnabled(false)).toBe(false);
  });

  it("is on once a profile exists", () => {
    expect(semanticButtonEnabled(true)).toBe(true);
  });
});

describe("syncSemanticRibbon", () => {
  it("asks the host to enable the control the manifest declared disabled", async () => {
    // The manifest ships `"enabled": false` so the button can never be pressed
    // before a profile exists. This is the only thing that turns it on, so it
    // has to name the exact control id from the manifest.
    const requestUpdate = vi.fn().mockResolvedValue(undefined);
    setOffice({ ribbon: { requestUpdate } });

    await expect(syncSemanticRibbon(true)).resolves.toBe(true);
    expect(requestUpdate).toHaveBeenCalledWith({
      tabs: [
        {
          id: "ToneForge",
          groups: [
            {
              id: SEMANTIC_RIBBON_GROUP,
              controls: [{ id: SEMANTIC_RIBBON_CONTROL, enabled: true }],
            },
          ],
        },
      ],
    });
  });

  it("turns the control back off when the profile goes away", async () => {
    const requestUpdate = vi.fn().mockResolvedValue(undefined);
    setOffice({ ribbon: { requestUpdate } });

    await syncSemanticRibbon(false);
    expect(requestUpdate.mock.calls[0]?.[0]).toMatchObject({
      tabs: [{ groups: [{ controls: [{ enabled: false }] }] }],
    });
  });

  it("keeps the manifest's disabled state on a host without the ribbon API", async () => {
    // Not an error. An older host simply never gets the button, which is the
    // safe direction — the alternative would be a button that opens a page with
    // no profile on it.
    setOffice({});
    await expect(syncSemanticRibbon(true)).resolves.toBe(false);
  });

  it("swallows the documented post-upgrade failure rather than logging it as novel", async () => {
    // Office rejects with HostRestartNeeded after an add-in upgrade. It is
    // expected and not actionable, so it must not be reported as a fault.
    setOffice({
      ribbon: {
        requestUpdate: vi.fn().mockRejectedValue({ code: "HostRestartNeeded" }),
      },
    });

    await expect(syncSemanticRibbon(true)).resolves.toBe(false);
  });

  it("reports a real host failure without throwing out of the caller", async () => {
    setOffice({
      ribbon: { requestUpdate: vi.fn().mockRejectedValue(new Error("ribbon is gone")) },
    });

    await expect(syncSemanticRibbon(true)).resolves.toBe(false);
  });
});
