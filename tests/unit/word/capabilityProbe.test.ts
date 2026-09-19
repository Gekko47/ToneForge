import { describe, it, expect } from "vitest";
import { probeWordCapabilities } from "../../../src/word/capabilityProbe";

describe("probeWordCapabilities", () => {
  it("returns a capability object with all keys", async () => {
    const caps = await probeWordCapabilities();
    expect(caps).toHaveProperty("supportsInsertText");
    expect(caps).toHaveProperty("supportsReplaceText");
    expect(caps).toHaveProperty("supportsInsertParagraph");
    expect(caps).toHaveProperty("supportsInsertBreak");
    expect(caps).toHaveProperty("supportsStyles");
    expect(caps).toHaveProperty("supportsRevisions");
    expect(caps).toHaveProperty("hostName");
    expect(caps).toHaveProperty("hostVersion");
    expect(["Word", "Excel", "PowerPoint", "unknown"]).toContain(caps.hostName);
  });
});
