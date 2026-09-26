import { describe, expect, it } from "vitest";
import { v4 as uuidv4 } from "uuid";
import {
  applyReadiness,
  hostReadinessMessage,
} from "../../../../src/taskpane/settings/applyReadiness";
import type { WordCapabilities } from "../../../../src/word/capabilityProbe";
import { createChangePlan } from "../../../../src/core/domain/ChangePlan";
import type { Change } from "../../../../src/core/domain/Change";

function capabilities(overrides: Partial<WordCapabilities> = {}): WordCapabilities {
  return {
    supportsInsertText: true,
    supportsReplaceText: true,
    supportsInsertParagraph: true,
    supportsInsertBreak: true,
    supportsStyles: true,
    supportsParagraphFormat: true,
    supportsCharacterFormat: true,
    supportsResetCharacterFormatting: true,
    supportsListLevel: true,
    supportsRevisions: true,
    supportsSelection: true,
    supportsParagraphResolution: true,
    supportsHighlight: true,
    supportsContextMenu: true,
    hostName: "Word",
    hostVersion: "16.0",
    ...overrides,
  };
}

function change(type: Change["type"]): Change {
  const plan = createChangePlan("hash", "base", []);
  return {
    id: uuidv4(),
    type,
    range: { start: 0, end: 1, unit: "character" },
    payload: {},
    ...plan.changes[0],
  } as unknown as Change;
}

describe("applyReadiness", () => {
  it("blocks Apply when tracked editing is off, and names Settings", () => {
    const result = applyReadiness({
      trackedEditingEnabled: false,
      capabilities: capabilities(),
      changes: [],
    });

    expect(result.verdict).toBe("trackedEditingOff");
    expect(result.reason).toMatch(/Settings/);
  });

  it("names Settings even when the host is also unprobed", () => {
    // The preference is the thing the user can act on, so it is reported first
    // rather than the probe state the apply gate will resolve anyway.
    const result = applyReadiness({
      trackedEditingEnabled: false,
      capabilities: null,
      changes: [],
    });
    expect(result.verdict).toBe("trackedEditingOff");
  });

  it("offers Apply when the host is merely unprobed, without claiming readiness", () => {
    // `prepareTrackedEditing` re-probes and arms the gate immediately before the
    // mutation, so an unprobed host is not a blocker — but nothing may be claimed
    // about this host yet either.
    const result = applyReadiness({
      trackedEditingEnabled: true,
      capabilities: null,
      changes: [],
    });

    expect(result.reason).toBeNull();
    expect(result.verdict).toBe("probePending");
    expect(result.probePendingOnly).toBe(true);
  });

  it("blocks Apply when the host has no revision support", () => {
    const result = applyReadiness({
      trackedEditingEnabled: true,
      capabilities: capabilities({ supportsRevisions: false }),
      changes: [],
    });

    expect(result.verdict).toBe("noRevisionSupport");
    expect(result.reason).toMatch(/revision/i);
  });

  it("blocks and names the operation when a change type is unsupported", () => {
    const result = applyReadiness({
      trackedEditingEnabled: true,
      capabilities: capabilities({ supportsParagraphFormat: false }),
      changes: [change("setParagraphFormat")],
    });

    expect(result.verdict).toBe("unsupportedOperations");
    expect(result.reason).toContain("set paragraph formatting");
  });

  it("names every unsupported operation once, not once per change", () => {
    const result = applyReadiness({
      trackedEditingEnabled: true,
      capabilities: capabilities({ supportsStyles: false, supportsListLevel: false }),
      changes: [change("applyStyle"), change("applyStyle"), change("setListLevel")],
    });

    expect(result.reason).toContain("apply a named style");
    expect(result.reason).toContain("set a list level");
    expect(result.reason?.match(/apply a named style/g)).toHaveLength(1);
  });

  it("reports ready when the preference is on and every operation is supported", () => {
    const result = applyReadiness({
      trackedEditingEnabled: true,
      capabilities: capabilities(),
      changes: [change("replaceText")],
    });

    expect(result).toEqual({ reason: null, verdict: "ready", probePendingOnly: false });
  });
});

describe("hostReadinessMessage", () => {
  it("states that the host can apply tracked changes", () => {
    expect(
      hostReadinessMessage({ trackedEditingEnabled: true, capabilities: capabilities() }),
    ).toEqual({ verdict: "ready", message: "This Word host can apply tracked changes." });
  });

  it("says nothing is claimed while the host is unprobed", () => {
    expect(hostReadinessMessage({ trackedEditingEnabled: true, capabilities: null }).verdict).toBe(
      "pending",
    );
  });

  it("distinguishes a preference that is off from a host that cannot", () => {
    // Both block mutation, but the user's remedy differs, so the wording differs.
    const off = hostReadinessMessage({
      trackedEditingEnabled: false,
      capabilities: capabilities(),
    });
    const unsupported = hostReadinessMessage({
      trackedEditingEnabled: true,
      capabilities: capabilities({ supportsRevisions: false }),
    });

    expect(off.verdict).toBe("blocked");
    expect(unsupported.verdict).toBe("blocked");
    expect(off.message).not.toEqual(unsupported.message);
    expect(unsupported.message).toMatch(/does not support tracked revisions/);
  });
});
