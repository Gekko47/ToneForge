import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAnnouncement } from "../../../../src/taskpane/settings/useAnnouncement";

describe("useAnnouncement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays silent until the quiet period elapses", () => {
    const { result } = renderHook(() => useAnnouncement(400));

    act(() => {
      result.current.announce("Scan complete.");
    });
    expect(result.current.message).toBeNull();

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.message).toBe("Scan complete.");
  });

  it("collapses a burst of updates into the most recent message", () => {
    const { result } = renderHook(() => useAnnouncement(400));

    act(() => {
      result.current.announce("Scanning…");
      result.current.announce("Scan complete.");
      result.current.announce("Plan ready.");
      vi.advanceTimersByTime(400);
    });

    expect(result.current.message).toBe("Plan ready.");
  });

  it("drops a pending message when cleared", () => {
    const { result } = renderHook(() => useAnnouncement(400));

    act(() => {
      result.current.announce("Draft published.");
      result.current.clear();
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.message).toBeNull();
  });
});
