/**
 * DeterministicStyleSections — the §21 profile editor IA.
 *
 * Spec §4.1, §6 and §21. The four deterministic sections as collapsible blocks,
 * each marked with whether *this* Word host can read the content it governs.
 *
 * **Why the marking is per-section and not one banner.** A host that cannot read
 * page setup can still read the body perfectly, and a single "some sections are
 * unsupported" note tells the user nothing about which. More importantly, a
 * section that looks like the others is the failure §9 exists to prevent: a user
 * who sets a table style, never sees a table finding, and concludes the document
 * complies — when the table was never examined. The marking is on the section
 * that cannot be checked, not on the profile as a whole.
 *
 * **Why the sections are still editable when unsupported.** The host may be
 * replaced and the profile is a durable record of the house standard. Blocking
 * the edit would leave a user stuck with whatever default shipped, and the
 * standard would be wrong the moment they moved to a desktop Word. What is not
 * allowed is the edit looking effective; the section says what it will and will
 * not do on this host.
 */

import React from "react";
import ProfileSection from "./ProfileSection";
import {
  DocumentFormattingProfileSchema,
  DocumentStructureProfileSchema,
  LanguageConventionProfileSchema,
  type DeterministicStyleProfile,
} from "../../core/domain/StyleProfile";
import type { WordCapabilities } from "../../word/capabilityProbe";

export interface DeterministicStyleSectionsProps {
  profile: DeterministicStyleProfile;
  onChange: (next: DeterministicStyleProfile) => void;
  /**
   * The live capability set, or `null` before the probe has answered.
   *
   * `null` is a third state, not a synonym for unsupported: marking a section
   * unsupported before the probe has run would be a claim about the host nobody
   * made. Until it answers, the section simply carries no marking.
   */
  capabilities: WordCapabilities | null;
}

function set<K extends keyof DeterministicStyleProfile>(
  profile: DeterministicStyleProfile,
  key: K,
  value: DeterministicStyleProfile[K],
): DeterministicStyleProfile {
  return { ...profile, [key]: value };
}

export default function DeterministicStyleSections({
  profile,
  onChange,
  capabilities,
}: DeterministicStyleSectionsProps): React.ReactNode {
  const patchLanguage = (values: Record<string, unknown>): void =>
    onChange(
      set(
        profile,
        "language",
        LanguageConventionProfileSchema.parse({ ...profile.language, ...values }),
      ),
    );
  /*
   * No `patchTypography`, and that is deliberate.
   *
   * Every typography setting already has a named control in the Typography
   * panel above, each one bound to the exact dropdown the rule reads. A second
   * editor for the same section would give the user two places to change one
   * setting, and the section here exists to summarise and to hold what has no
   * control yet — not to duplicate what does.
   */
  const patchFormatting = (values: Record<string, unknown>): void =>
    onChange(
      set(
        profile,
        "formatting",
        DocumentFormattingProfileSchema.parse({ ...profile.formatting, ...values }),
      ),
    );
  const patchStructure = (values: Record<string, unknown>): void =>
    onChange(
      set(
        profile,
        "structure",
        DocumentStructureProfileSchema.parse({ ...profile.structure, ...values }),
      ),
    );

  return (
    <div aria-label="Deterministic style sections">
      <ProfileSection
        id="language"
        title="Language"
        summary="Terminology, capitalisation, abbreviations, and the number, date, currency and unit conventions this house writes in."
        supported={capabilities === null ? null : true}
        defaultOpen
      >
        {/*
         * No terminology field here, and that is a correction rather than an
         * omission.
         *
         * This section originally carried its own "Preferred terminology" box,
         * which duplicated the one in the House style panel immediately below —
         * two controls with the same label, editing the same record through two
         * different parse paths, and the House style one is the one with the
         * line-validation that tells a user their `term: replacement` is
         * malformed. The duplicate silently won on save for whichever was
         * touched last, and the existing test for the parse error broke on the
         * ambiguity.
         *
         * So the field stays in one place. What belongs here is what has no
         * editor anywhere: the settings the registry reads and nothing in the
         * pane reaches.
         */}
        <label className="tf-field tf-field-inline">
          <input
            type="checkbox"
            checked={profile.language.capitalisation.sentenceCase}
            onChange={(event) =>
              patchLanguage({
                capitalisation: {
                  ...profile.language.capitalisation,
                  sentenceCase: event.target.checked,
                },
              })
            }
          />
          <span>Sentences begin with a capital letter</span>
        </label>
        <label className="tf-field">
          <span>Locale metadata (recorded, not enforced)</span>
          <input
            type="text"
            value={profile.language.locale}
            onChange={(event) => patchLanguage({ locale: event.target.value })}
          />
        </label>
        <p className="tf-sub">
          Terminology, abbreviations, and the number, date, currency and unit conventions are set in
          the House style panel and through the governance policy. This section is where the
          capitalisation and locale settings live.
        </p>
      </ProfileSection>

      <ProfileSection
        id="typography"
        title="Typography"
        summary="Dashes, quotes, ellipses, and the whitespace and spacing conventions this house prints in."
        supported={capabilities === null ? null : true}
      >
        <p className="tf-sub">
          The individual dash, quote and ellipsis controls are in the Typography panel above; this
          section is the normative summary the rules read.
        </p>
      </ProfileSection>

      <ProfileSection
        id="formatting"
        title="Document formatting"
        summary="The Word style each paragraph kind must carry, and the table, header/footer and page-setup standards."
        supported={capabilities === null ? null : capabilities.supportsTables}
        unsupportedReason="This Word version cannot read table properties, so a table standard set here is stored but not compared."
      >
        <label className="tf-field">
          <span>Body style</span>
          <input
            type="text"
            value={profile.formatting.bodyStyle.styleName}
            onChange={(event) =>
              patchFormatting({
                bodyStyle: { ...profile.formatting.bodyStyle, styleName: event.target.value },
              })
            }
          />
        </label>
      </ProfileSection>

      <ProfileSection
        id="structure"
        title="Document structure"
        summary="Whether a skipped heading level or an empty heading is a finding, and how deep the document may nest."
        supported={capabilities === null ? null : true}
      >
        <label className="tf-field tf-field-inline">
          <input
            type="checkbox"
            checked={profile.structure.reportEmptyHeadings}
            onChange={(event) => patchStructure({ reportEmptyHeadings: event.target.checked })}
          />
          <span>Report empty headings</span>
        </label>
        <label className="tf-field tf-field-inline">
          <input
            type="checkbox"
            checked={profile.structure.reportUnknownStyles}
            onChange={(event) => patchStructure({ reportUnknownStyles: event.target.checked })}
          />
          <span>Report styles ToneForge does not recognise</span>
        </label>
        <label className="tf-field tf-field-inline">
          <input
            type="checkbox"
            checked={profile.structure.allowSkippedHeadingLevels}
            onChange={(event) =>
              patchStructure({ allowSkippedHeadingLevels: event.target.checked })
            }
          />
          <span>Allow a skipped heading level</span>
        </label>
      </ProfileSection>
    </div>
  );
}
