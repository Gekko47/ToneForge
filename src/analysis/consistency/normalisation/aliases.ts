/**
 * Alias resolution (original §8: validated aliases).
 *
 * A document names one party many ways: "the Contractor",
 * "ABC Ltd", "the contractor". The extraction pass assigns
 * canonical ids; the alias index folds every validated label
 * of an entity onto its canonical id, so a mention by any
 * label reaches the same index entry.
 *
 * Only validated labels enter the index — an alias the
 * extraction did not assert is a guess, and guesses are how
 * one entity silently becomes two, or two become one.
 */

import { normalizeForComparison } from "../checks/primitives";
import type { PartyRef } from "../contracts";

/** One validated label of one canonical entity. */
export interface AliasEntry {
  readonly entityId: string;
  readonly label: string;
}

/** The alias index: every validated label, folded onto its entity. */
export interface AliasIndex {
  /** How many distinct labels the index holds. */
  readonly size: number;
  /** The canonical entity a label refers to, or null when the label is unvalidated. */
  resolve(label: string): string | null;
  /**
   * Every validated label of one entity, its canonical name
   * first. Empty when the entity is not a named party.
   */
  labelsFor(entityId: string): readonly string[];
}

/**
 * Build the alias index from validated entries.
 *
 * The first entry for a label wins: when two entities claim
 * one label, the document is ambiguous about it, and the
 * first in document order is the resolution the extraction
 * asserted first.
 */
export function buildAliasIndex(entries: readonly AliasEntry[]): AliasIndex {
  const byLabel = new Map<string, string>();
  const byEntity = new Map<string, string[]>();
  entries.forEach(({ entityId, label }) => {
    const key = normalizeForComparison(label);
    if (key.length === 0) return;
    if (!byLabel.has(key)) {
      byLabel.set(key, entityId);
    }
    const labels = byEntity.get(entityId);
    if (labels === undefined) {
      byEntity.set(entityId, [label]);
    } else if (!labels.includes(label)) {
      labels.push(label);
    }
  });
  return {
    size: byLabel.size,
    resolve(label: string): string | null {
      return byLabel.get(normalizeForComparison(label)) ?? null;
    },
    labelsFor(entityId: string): readonly string[] {
      return byEntity.get(entityId) ?? [];
    },
  };
}

/**
 * The alias entries a party contributes: its name, and every
 * alias the extraction validated for it. The name is first, so
 * it is the entity's canonical label.
 */
export function partyAliases(party: PartyRef, aliases: readonly string[] = []): AliasEntry[] {
  return [party.name, ...aliases].map((label) => ({
    entityId: party.id,
    label,
  }));
}
