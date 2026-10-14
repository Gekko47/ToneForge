import { describe, it, expect, vi, afterEach } from "vitest";
import { readTrackedRevisions } from "../../../src/word/revisionInspection";

function setOffice(office: unknown) {
  (globalThis as unknown as { Office?: unknown }).Office = office;
}

function makeChangeItem(overrides: {
  author?: string;
  date?: string | null;
  text?: string;
  type?: string;
  getRange?: () => unknown;
}) {
  return {
    author: overrides.author ?? "Alice",
    date: overrides.date !== undefined ? overrides.date : "2026-10-13T10:00:00Z",
    text: overrides.text ?? "some text",
    type: overrides.type ?? "Added",
    load: vi.fn(),
    getRange:
      overrides.getRange ??
      (() => ({
        start: 10,
        end: 20,
        load: vi.fn(),
      })),
  };
}

function makeOfficeWithChanges(changeItems: unknown[]) {
  const body = {
    text: "",
    load: vi.fn(),
    getTrackedChanges: vi.fn(() => ({
      items: changeItems,
      load: vi.fn(),
    })),
  };
  return {
    run: <T>(func: (context: unknown) => Promise<T>): Promise<T> =>
      func({
        document: {
          body,
          getSelection: vi.fn(() => ({ getRange: vi.fn() })),
          styles: { name: "", load: vi.fn(), items: [] },
        },
        host: { name: "Word", version: "16.0" },
        sync: vi.fn(),
      }),
    roamingSettings: {
      get: vi.fn(),
      set: vi.fn(),
      saveAsync: vi.fn(),
    },
    InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
  };
}

function makeOfficeWithoutGetTrackedChanges() {
  const body = {
    text: "",
    load: vi.fn(),
  };
  return {
    run: <T>(func: (context: unknown) => Promise<T>): Promise<T> =>
      func({
        document: {
          body,
          getSelection: vi.fn(() => ({ getRange: vi.fn() })),
          styles: { name: "", load: vi.fn(), items: [] },
        },
        host: { name: "Word", version: "16.0" },
        sync: vi.fn(),
      }),
    roamingSettings: {
      get: vi.fn(),
      set: vi.fn(),
      saveAsync: vi.fn(),
    },
    InsertBreakBehavior: { Paragraph: 0, LineBreak: 1, PageBreak: 2 },
  };
}

describe("readTrackedRevisions", () => {
  let originalOffice: unknown;

  afterEach(() => {
    setOffice(originalOffice);
  });

  it("returns supported: false when getTrackedChanges is absent", async () => {
    originalOffice = (globalThis as unknown as { Office?: unknown }).Office;
    setOffice(makeOfficeWithoutGetTrackedChanges());
    const result = await readTrackedRevisions();
    expect(result.supported).toBe(false);
    expect(result.revisions).toEqual([]);
  });

  it("reads a served collection with author, date, text, type, and range", async () => {
    originalOffice = (globalThis as unknown as { Office?: unknown }).Office;
    const items = [
      makeChangeItem({ author: "ToneForge", text: "corrected", type: "Added" }),
      makeChangeItem({ author: "Bob", text: "deleted text", type: "Deleted", date: null }),
    ];
    setOffice(makeOfficeWithChanges(items));

    const result = await readTrackedRevisions();
    expect(result.supported).toBe(true);
    expect(result.revisions).toHaveLength(2);

    const r0 = result.revisions[0]!;
    const r1 = result.revisions[1]!;

    expect(r0.author).toBe("ToneForge");
    expect(r0.text).toBe("corrected");
    expect(r0.type).toBe("Added");
    expect(r0.date).toBe("2026-10-13T10:00:00Z");
    expect(r0.range).toEqual({ start: 10, end: 20 });
    expect(r0.index).toBe(0);

    expect(r1.author).toBe("Bob");
    expect(r1.text).toBe("deleted text");
    expect(r1.type).toBe("Deleted");
    expect(r1.date).toBeNull();
    expect(r1.range).toEqual({ start: 10, end: 20 });
    expect(r1.index).toBe(1);
  });

  it("accepts a Date object for date, which is what Desktop Word serves", async () => {
    originalOffice = (globalThis as unknown as { Office?: unknown }).Office;
    const served = makeChangeItem({ author: "Ross Jarvis", text: "—", type: "Added" });
    // Real Desktop Word serves `date` as a Date object, not a string; the DTO
    // schema wants a string, so the reader must coerce it or drop the row.
    (served as Record<string, unknown>).date = new Date("2026-10-13T10:00:00Z");
    setOffice(makeOfficeWithChanges([served]));

    const result = await readTrackedRevisions();
    expect(result.supported).toBe(true);
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]!.author).toBe("Ross Jarvis");
    expect(result.revisions[0]!.date).toBe("2026-10-13T10:00:00.000Z");
  });

  it("one bad range degrades only that row, not the whole read", async () => {
    originalOffice = (globalThis as unknown as { Office?: unknown }).Office;
    const items = [
      makeChangeItem({ author: "Alice", text: "first" }),
      makeChangeItem({
        author: "Bob",
        text: "second",
        getRange: () => {
          throw new Error("getRange failed");
        },
      }),
      makeChangeItem({ author: "Carol", text: "third" }),
    ];
    setOffice(makeOfficeWithChanges(items));

    const result = await readTrackedRevisions();
    expect(result.supported).toBe(true);
    expect(result.revisions).toHaveLength(3);

    const r0 = result.revisions[0]!;
    const r1 = result.revisions[1]!;
    const r2 = result.revisions[2]!;

    expect(r0.author).toBe("Alice");
    expect(r0.range).toEqual({ start: 10, end: 20 });

    // The bad row still appears, but with null range.
    expect(r1.author).toBe("Bob");
    expect(r1.range).toBeNull();

    expect(r2.author).toBe("Carol");
    expect(r2.range).toEqual({ start: 10, end: 20 });
  });

  it("never calls accept, reject, acceptAll, or rejectAll", async () => {
    originalOffice = (globalThis as unknown as { Office?: unknown }).Office;
    const accept = vi.fn();
    const reject = vi.fn();
    const acceptAll = vi.fn();
    const rejectAll = vi.fn();

    const items = [makeChangeItem({ author: "Alice", text: "edit" })];
    // Add accept/reject methods to the items to prove they are never called.
    (items[0] as Record<string, unknown>).accept = accept;
    (items[0] as Record<string, unknown>).reject = reject;
    (items[0] as Record<string, unknown>).acceptAll = acceptAll;
    (items[0] as Record<string, unknown>).rejectAll = rejectAll;

    setOffice(makeOfficeWithChanges(items));

    await readTrackedRevisions();

    expect(accept).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
    expect(acceptAll).not.toHaveBeenCalled();
    expect(rejectAll).not.toHaveBeenCalled();
  });

  it("skips items that fail to load", async () => {
    originalOffice = (globalThis as unknown as { Office?: unknown }).Office;
    const goodItem = makeChangeItem({ author: "Alice", text: "good" });
    const badItem = {
      author: "Bob",
      date: null,
      text: "bad",
      type: "Added",
      load: vi.fn(() => {
        throw new Error("load failed");
      }),
      getRange: vi.fn(),
    };
    setOffice(makeOfficeWithChanges([goodItem, badItem]));

    const result = await readTrackedRevisions();
    expect(result.supported).toBe(true);
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]!.author).toBe("Alice");
  });

  it("handles null date gracefully", async () => {
    originalOffice = (globalThis as unknown as { Office?: unknown }).Office;
    const items = [makeChangeItem({ author: "Alice", text: "no date", date: null })];
    setOffice(makeOfficeWithChanges(items));

    const result = await readTrackedRevisions();
    expect(result.revisions[0]!.date).toBeNull();
  });

  it("handles missing getRange method on a change item", async () => {
    originalOffice = (globalThis as unknown as { Office?: unknown }).Office;
    const item = makeChangeItem({ author: "Alice", text: "no getRange" });
    // Remove getRange
    delete (item as Record<string, unknown>).getRange;
    setOffice(makeOfficeWithChanges([item]));

    const result = await readTrackedRevisions();
    expect(result.supported).toBe(true);
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]!.range).toBeNull();
  });
});
