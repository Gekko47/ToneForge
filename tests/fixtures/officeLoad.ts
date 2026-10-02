/**
 * The Office.js `load` contract, as a reusable test double.
 *
 * **Why this file exists.** `Range.load` was declared variadic in
 * `src/types/office.d.ts` so that `load("text", "start", "end")` would
 * typecheck. The real signature is `load(propertyNames: string | string[])`:
 * the host loads the **first** positional argument and silently ignores the
 * rest, so the following read of `.start` threw in a real Word while 2 350
 * tests passed. The tests passed because every mock involved was *more
 * permissive than the host* — one declared `load(...props: string[])` and
 * honoured all three names, another was `load: vi.fn()`, which accepts anything
 * and loads nothing. (ADR-0100.)
 *
 * A mock that is more permissive than the host is a hole in the suite, and it is
 * invisible by construction: it is the thing that was supposed to catch the bug.
 * So the rule here is that this double **fails loudly** on a call the host would
 * not honour, rather than being convenient.
 */

export interface OfficeLoadLog {
  /** Every property name passed, in call order, flattened for assertion. */
  readonly requests: string[];
}

/**
 * A `load` that behaves as the host does: one argument, or a list.
 *
 * Throws when given extra positional arguments. That is the whole point — the
 * host does not throw there, it *silently drops* them, and the failure surfaces
 * later as an unrelated-looking "property is not available" error. Failing at the
 * call site turns a confusing production error into a test failure that names the
 * mistake.
 */
export function createOfficeLoad(
  onRequest: (property: string) => void,
  owner: () => unknown,
): (propertyNames: string | string[]) => unknown {
  return function load(this: unknown, ...args: unknown[]): unknown {
    if (args.length > 1) {
      throw new Error(
        `Office.js \`load\` takes one argument. Received ${args.length}: ` +
          `${args.map((arg) => JSON.stringify(arg)).join(", ")}. ` +
          `The host loads the first and ignores the rest, so the properties after it ` +
          `read as unavailable — pass an array instead: load(${JSON.stringify(args[0])}, ...). ` +
          `See ADR-0100.`,
      );
    }
    const [first] = args;
    const names =
      typeof first === "string" ? [first] : Array.isArray(first) ? (first as string[]) : [];
    if (typeof first !== "string" && !Array.isArray(first)) {
      throw new Error(
        `Office.js \`load\` takes a property name or an array of them, received ${JSON.stringify(first)}.`,
      );
    }
    names.forEach((name) => onRequest(name));
    return owner();
  };
}

/**
 * A `sync` that has already happened.
 *
 * Office.js requires `load()` then `context.sync()`. A mock's `sync` that is a
 * no-op is correct — the reads are served from the double's own values, not from a
 * real host round trip — and this indirection exists so a test that *wants* to
 * model a refusing host has one place to make it refuse.
 */
export function syncStub(): Promise<void> {
  return Promise.resolve();
}

/**
 * Give an object a faithful `load`, returning that same object.
 *
 * Preferable to writing `load: createOfficeLoad(..., () => this)` inline: an
 * arrow function in an object literal has no `this` of its own, and a
 * self-referential initializer is a circular inference that TypeScript resolves to
 * `any` \u2014 at which point the double has stopped checking anything, which is the
 * failure this file exists to end.
 */
export function attachOfficeLoad<T extends object>(
  target: T,
  onRequest: (property: string) => void,
): T & { load: (propertyNames: string | string[]) => unknown } {
  const load = createOfficeLoad(onRequest, () => target);
  Object.assign(target, { load });
  return target as T & { load: (propertyNames: string | string[]) => unknown };
}

/** Records requests into a `OfficeLoadLog`, for a test that asserts what was asked for. */
export function createLoadRecorder(): {
  log: OfficeLoadLog;
  record: (property: string) => void;
} {
  const requests: string[] = [];
  return {
    log: { requests },
    record: (property: string) => {
      requests.push(property);
    },
  };
}
