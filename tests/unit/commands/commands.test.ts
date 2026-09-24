import { afterEach, describe, expect, it, vi } from "vitest";
import {
  associateCommandActions,
  openFindings,
  openPendingChanges,
  reviewDocument,
  reviewSelection,
  scanNow,
} from "../../../src/commands/commands";
import { consumeTaskpaneTarget } from "../../../src/shared/office/taskpaneNavigation";

function setOffice(value: unknown): void {
  (globalThis as { Office?: unknown }).Office = value;
}

describe("command entry points", () => {
  afterEach(() => {
    setOffice(undefined);
    vi.restoreAllMocks();
  });

  it("associates every manifest executeFunction action and completes events", async () => {
    const associate = vi.fn();
    setOffice({ actions: { associate } });
    associateCommandActions();
    expect(associate).toHaveBeenCalledTimes(7);
    const scan = associate.mock.calls.find(([id]) => id === "ToneForgeScan");
    const handler = scan?.[1] as (event: { completed: () => void }) => Promise<void>;
    const completed = vi.fn();
    await handler({ completed });
    expect(completed).toHaveBeenCalledOnce();
  });

  it("opens the requested task-pane destinations", async () => {
    const showAsTaskpane = vi.fn().mockResolvedValue(undefined);
    setOffice({ addin: { showAsTaskpane } });
    await scanNow();
    expect(consumeTaskpaneTarget()).toBe("governance");
    await openFindings();
    expect(consumeTaskpaneTarget()).toBe("findings");
    await reviewDocument();
    expect(consumeTaskpaneTarget()).toBe("ai-review-document");
    await openPendingChanges();
    expect(consumeTaskpaneTarget()).toBe("pending-changes");
    expect(showAsTaskpane).toHaveBeenCalledTimes(4);
  });

  it("falls back safely when Office is unavailable", async () => {
    setOffice(undefined);
    await reviewSelection();
    expect(consumeTaskpaneTarget()).toBe("governance");
  });
});
