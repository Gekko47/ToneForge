import { describe, it, expect } from "vitest";
import { createEmptyProfile, StyleProfileSchema } from "../../../../src/core/domain/index";

describe("createEmptyProfile", () => {
  it("creates a valid profile with defaults", () => {
    const profile = createEmptyProfile("Test Style");
    expect(profile.name).toBe("Test Style");
    expect(profile.revision).toBe(1);
    expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(profile.createdAt).toBeTruthy();
  });

  it("accepts a custom revision number", () => {
    const profile = createEmptyProfile("Test", 7);
    expect(profile.revision).toBe(7);
  });
});

describe("StyleProfileSchema", () => {
  it("rejects an invalid profile", () => {
    const result = StyleProfileSchema.safeParse({
      id: "not-a-uuid",
      name: "",
      revision: -1,
      measured: {},
      semantic: {},
      typography: {},
      houseStyle: {},
      createdAt: "bad-date",
      updatedAt: "bad-date",
      sourceSampleIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer revision", () => {
    const result = StyleProfileSchema.safeParse({
      ...createEmptyProfile("Test"),
      revision: 1.5,
    });
    expect(result.success).toBe(false);
  });
});
