import { describe, expect, it, vi } from "vitest";
import { createNavigationController } from "../../../../src/taskpane/workflow/navigationController";

describe("navigationController", () => {
  it("serializes requests, rejects stale ones, and reports outcomes", async () => {
    const order: string[] = [];
    const navigate = vi.fn(async (request) => {
      order.push(`start:${request.requestId}`);
      await Promise.resolve();
      order.push(`end:${request.requestId}`);
      return { requestId: request.requestId, ok: true, message: "moved" };
    });
    const outcomes: string[] = [];
    const controller = createNavigationController({
      navigate,
      onOutcome: (outcome) => outcomes.push(outcome.message),
    });

    const [first, repeat] = await Promise.all([
      controller.request({ requestId: "a", kind: "finding", identity: "f1" }),
      controller.request({ requestId: "a", kind: "finding", identity: "f1" }),
    ]);

    expect(first.ok).toBe(true);
    expect(repeat.ok).toBe(false);
    expect(repeat.message).toContain("stale");
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe("start:a");
    expect(controller.isBusy()).toBe(false);
    expect(outcomes).toContain("moved");

    const accepted = await controller.request({ requestId: "a", kind: "finding", identity: "f1" });
    expect(accepted.ok).toBe(false);
  });

  it("converts host failures into a refused outcome", async () => {
    const controller = createNavigationController({
      navigate: async () => {
        throw new Error("host refused the range");
      },
    });
    const outcome = await controller.request({ requestId: "b", kind: "change", identity: "c1" });
    expect(outcome).toEqual({ requestId: "b", ok: false, message: "host refused the range" });
  });
});
