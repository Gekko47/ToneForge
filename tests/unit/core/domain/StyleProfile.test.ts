import { describe, it, expect } from "vitest";
import { createEmptyProfile, StyleProfileSchema } from "../../../../src/core/domain/index";

describe("createEmptyProfile", () => {
  it("creates a valid profile with defaults", () => {
    const profile = createEmptyProfile("Test Style");
    expect(profile.name).toBe("Test Style");
    expect(profile.version).toEqual({ major: 1, minor: 0, patch: 0 });
    expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(profile.createdAt).toBeTruthy();
  });

  it("accepts custom version", () => {
    const profile = createEmptyProfile("Test", { major: 2, minor: 1, patch: 3 });
    expect(profile.version).toEqual({ major: 2, minor: 1, patch: 3 });
  });
});

describe("StyleProfileSchema", () => {
  it("rejects invalid version", () => {
    const result = StyleProfileSchema.safeParse({
      id: "not-a-uuid",
      name: "",
      version: { major: -1, minor: 0, patch: 0 },
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
});
