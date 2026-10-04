import tseslint from "@typescript-eslint/eslint-plugin";
import tseslintParser from "@typescript-eslint/parser";
import prettierConfig from "eslint-config-prettier";

export default [
  prettierConfig,
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx"],
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        Office: "readable",
        window: "readable",
        document: "readable",
        navigator: "readable",
        console: "readable",
        setTimeout: "readable",
        clearTimeout: "readable",
        setInterval: "readable",
        clearInterval: "readable",
        fetch: "readable",
        AbortController: "readable",
        Blob: "readable",
        // Read by `LearnSemanticStyle` for a `.txt` import. The validator is
        // DOM-free by design (D8), so the only place a `File` may be named is
        // the component that owns the `<input type="file">`.
        File: "readable",
        URL: "readable",
        btoa: "readable",
        atob: "readable",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "ForStatement",
          message: "Use array methods or forEach instead of for loops",
        },
      ],
    },
  },
  {
    /*
     * No colour literals in components.
     *
     * `taskpane.css` owns the palette, in tokens that flip with the theme. A
     * hex or rgb() pasted into a component bypasses that entirely: it cannot
     * follow the theme, and it is invisible to anyone changing the palette.
     * Two of the three that had accumulated were in components with no
     * production caller, which is how they survived — nothing rendered them,
     * so nothing looked wrong.
     *
     * `src/taskpane/fluentTheme.ts` is exempt because it *is* the palette: it
     * defines the tokens, so a literal there is the definition rather than a
     * bypass. The CSS file is not linted by this rule at all, since tokens are
     * written there by design.
     */
    files: ["src/taskpane/**/*.tsx", "src/taskpane/**/*.ts"],
    ignores: ["src/taskpane/fluentTheme.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
          message:
            "Use a theme token such as var(--tf-border) instead of a colour literal; tokens are defined in src/taskpane/taskpane.css and flip with the theme.",
        },
        {
          selector: "Literal[value=/^rgba?\\(/]",
          message:
            "Use a theme token such as var(--tf-surface) instead of a colour literal; tokens are defined in src/taskpane/taskpane.css and flip with the theme.",
        },
        /*
         * Font sizes, added in S10 — the gap this file's colour rule left open.
         *
         * `ProfileEditor` carried `sectionHeadingStyle = { fontSize: 20 }` for
         * years. It survived because 20 is not a colour, so the rule above had
         * nothing to say about it, and because a size inside a
         * `React.CSSProperties` object cannot be changed by a stylesheet rule or
         * by the heading ramp added later. The result was a 20px section heading
         * beside a 14px page title: an inverted hierarchy no rule could reach.
         *
         * Only sizes on the ramp are allowed, so a value that means something
         * cannot be written where it cannot be changed. The ramp itself lives in
         * `taskpane.css`; `fluentTheme.ts` is exempt below for the same reason
         * the colour rule exempts it — it defines the palette, so a literal there
         * is the definition rather than an escape from it.
         */
        {
          selector:
            "Property[key.name=/^(fontSize|font-size)$/] > Literal[value=/^\\d+(\\.\\d+)?(px|rem|em)?$/]",
          message:
            "Use a type token from src/taskpane/taskpane.css instead of a hard-coded font size; the ramp is --tf-font-title / subtitle / body / caption / annotation.",
        },
        {
          selector:
            "JSXAttribute[name.name='style'] > JSXExpressionContainer > ObjectExpression > Property[key.name=/^(fontSize|font-weight|lineHeight)$/]",
          message:
            "Style in the stylesheet rather than an inline style object: an inline size cannot be re-themed or moved onto the type ramp.",
        },
      ],
    },
  },
  {
    // Enforces docs/architecture.md: core/domain may only import zod and
    // shared/utils — never word, ai, ui, or Office (see ADR-0013).
    files: ["src/core/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Every bare form is listed alongside its subpath form. A directory
              // import such as "../../word" resolves through the directory's
              // index.ts to the same module, and a subpath-only glob would not
              // match it — so a scope listing only subpaths has a hole in it
              // exactly where a boundary is easiest to cross. (Written as line
              // comments: a block comment here would terminate on the glob text.)
              group: [
                "**/word",
                "**/word/*",
                "**/ai",
                "**/ai/*",
                "**/taskpane",
                "**/taskpane/*",
                "**/commands",
                "**/commands/*",
              ],
              message:
                "core/domain must stay Office-free: allowed imports are zod and shared/utils only (architecture.md).",
            },
          ],
        },
      ],
    },
  },
  {
    // Enforces docs/architecture.md: word/ must not depend on ai or ui.
    files: ["src/word/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/ai/*", "**/taskpane/*"],
              message: "word/ must not depend on ai or ui (architecture.md).",
            },
            {
              // The bare form is listed as well as the subpath form: a directory
              // import such as `../../analysis/consistency` carries no trailing
              // segment, so `**/analysis/consistency/*` alone would not match it.
              group: [
                "**/analysis/consistency",
                "**/analysis/consistency/*",
                "**/analysis/consistency/index",
              ],
              message:
                "word/ and the observer must not call the consistency engine: it runs on a whole-document snapshot the user chose to review, never on an incremental or typing path (ADR-0052).",
            },
          ],
        },
      ],
    },
  },
  {
    // Enforces docs/architecture.md: rules/ must stay deterministic — no
    // Office, AI, or UI dependencies (see ADR-0006 and ADR-0013).
    files: ["src/rules/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/ai",
                "**/ai/*",
                "**/word",
                "**/word/*",
                "**/taskpane",
                "**/taskpane/*",
                "**/commands",
                "**/commands/*",
              ],
              message:
                "rules/ must stay deterministic: allowed imports are core/domain and shared/utils only (architecture.md).",
            },
          ],
        },
      ],
    },
  },
  {
    // Enforces docs/architecture.md: formatting/ must stay deterministic —
    // no Office, AI, or UI dependencies. Live Word reads live in src/word/
    // (see ADR-0006 and ADR-0013).
    files: ["src/formatting/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/ai",
                "**/ai/*",
                "**/word",
                "**/word/*",
                "**/taskpane",
                "**/taskpane/*",
                "**/commands",
                "**/commands/*",
              ],
              message:
                "formatting/ must stay deterministic: allowed imports are core/domain and shared/utils only (architecture.md).",
            },
          ],
        },
      ],
    },
  },
  {
    // Enforces docs/architecture.md: analysis/ may import core/domain, rules,
    // formatting, ai/providers, and shared/utils — never ui or
    // word/revisionAdapter (see ADR-0006 and ADR-0013).
    files: ["src/analysis/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/taskpane/*", "**/commands/*", "**/word/revisionAdapter*"],
              message: "analysis/ must not import ui or word/revisionAdapter (architecture.md).",
            },
          ],
        },
      ],
    },
  },
  {
    // Explicit scope for the coverage engines — pure, no Office/AI/UI imports.
    //
    // Both files are listed rather than one: deterministic review has its own
    // coverage projection beside the shared one, and omitting it would mean the
    // rule that makes coverage honest applies to half of it.
    files: ["src/analysis/coverage.ts", "src/analysis/deterministic/coverage.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/word/*", "**/ai/*", "**/taskpane/*", "**/commands/*"],
              message:
                "coverage must stay pure: allowed imports are core/domain and shared/utils only.",
            },
          ],
        },
      ],
    },
  },
  {
    // The deterministic review engine is deterministic by definition.
    //
    // Deterministic Review makes zero LLM calls and takes its evidence from the
    // AnalysisContext the Word boundary hands it, so it may reach neither `ai/`
    // nor `word/`. The general `src/analysis/**` block above permits both, which
    // is right for the rest of the directory and wrong here, so this narrower
    // block is declared after it. In flat config the last matching block wins,
    // which is the same ordering the consistency engine's exception relies on.
    files: ["src/analysis/deterministic/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Each bare form is listed alongside its subpath form, for the
              // same reason the consistency block lists both: a directory import
              // resolves through its index and would otherwise pass straight
              // through this restriction.
              group: [
                "**/ai",
                "**/ai/*",
                "**/word",
                "**/word/*",
                "**/taskpane",
                "**/taskpane/*",
                "**/commands",
                "**/commands/*",
                /*
                 * The orchestrator and the planner, for the same reason the
                 * consistency scope lists them (ADR-0052). A rule that could
                 * import `reformat/` could reach `word/revisionAdapter` through
                 * it, and one that could import `changes/` could build a plan
                 * and hand it to something that writes. The deterministic
                 * engine's claim is that it produces findings from an
                 * AnalysisContext and nothing else; these two are how that claim
                 * would stop being true without any local change looking wrong.
                 */
                "**/reformat",
                "**/reformat/*",
                "**/changes",
                "**/changes/*",
              ],
              message:
                "analysis/deterministic/ must stay deterministic: no provider, no Word, no UI, no orchestrator, no planner. It consumes an AnalysisContext and emits findings (architecture.md, ADR-0052).",
            },
          ],
        },
      ],
    },
  },
  {
    // The cross-report consistency engine is the ONE sanctioned exception to
    // deterministic-first (ADR-0052). It may reach `ai/providers` to reuse the
    // already-configured model for adjudication; it may NOT reach Word, the
    // task pane, commands, the orchestrator, or the planner. Those restrictions
    // are what keep the exception from becoming a general one: the engine
    // consumes a plain-text snapshot the caller supplies, so it cannot read or
    // mutate a live document even by accident.
    //
    // This block is deliberately placed after the general `src/analysis/**` block
    // above. In flat config the last matching block wins, so a narrower rule
    // declared earlier would be silently replaced by the broader one and the
    // engine's own exception would stop being enforced at all.
    files: ["src/analysis/consistency/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Each bare form is listed alongside its subpath form. `**/word/*`
              // matches `../../word/revisionAdapter` but not the directory import
              // `../../word`, which resolves to the same module through its index
              // and would otherwise pass straight through this restriction.
              group: [
                "**/word",
                "**/word/*",
                "**/taskpane",
                "**/taskpane/*",
                "**/commands",
                "**/commands/*",
                "**/reformat",
                "**/reformat/*",
                "**/changes",
                "**/changes/*",
              ],
              message:
                "analysis/consistency/ must not reach Word, the task pane, commands, the orchestrator, or the planner. It consumes a text snapshot and emits findings (ADR-0052).",
            },
          ],
        },
      ],
    },
  },
  {
    // The local preservation validator is offline by definition, not by habit.
    //
    // It is the gate between a model's prose and a user's document, and it has
    // to be able to run when no provider is configured, when the provider call
    // has already failed, and when the user is offline. A validator that could
    // reach `ai/` would be a validator whose verdict depended on a network
    // round-trip; one that could reach `word/` would be a validator that could
    // read the document it is supposed to be judging a change to.
    //
    // The general `src/analysis/**` block above permits both `ai/providers` and
    // `word/`, which is right for `deviationEngine.ts` and `rewriteEngine.ts`
    // and wrong here. In flat config the last matching block wins, so this
    // narrower block is declared after it — the same ordering the consistency
    // engine's exception depends on.
    files: [
      "src/analysis/semantic/protectedFacts.ts",
      "src/analysis/semantic/qualifiers.ts",
      "src/analysis/semantic/preservationValidator.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Each bare form is listed alongside its subpath form, for the
              // reason the consistency block gives: a directory import resolves
              // through its index and would pass straight through.
              group: [
                "**/ai",
                "**/ai/*",
                "**/word",
                "**/word/*",
                "**/taskpane",
                "**/taskpane/*",
                "**/commands",
                "**/commands/*",
                "**/reformat",
                "**/reformat/*",
              ],
              message:
                "the preservation validator must stay local and offline: it may import only its own modules and shared/utils. It runs before any provider is consulted, and it must keep working when none is configured.",
            },
          ],
        },
      ],
    },
  },
  {
    // Enforces docs/architecture.md: changes/ is pure and may import only
    // core/domain and shared/utils. It must never read Word, call AI, or touch UI.
    files: ["src/changes/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/analysis",
                "**/analysis/*",
                "**/rules",
                "**/rules/*",
                "**/formatting",
                "**/formatting/*",
                "**/style",
                "**/style/*",
                "**/ai",
                "**/ai/*",
                "**/word",
                "**/word/*",
                "**/taskpane",
                "**/taskpane/*",
                "**/commands",
                "**/commands/*",
              ],
              message:
                "changes/ must stay pure: allowed imports are core/domain and shared/utils only (architecture.md).",
            },
          ],
        },
      ],
    },
  },
  {
    // Enforces docs/architecture.md: reformat/ is the orchestrator and may
    // compose analysis, changes, word/documentReader, word/formattingReader,
    // word/revisionAdapter, ai/providers, and shared/utils. It must never
    // import taskpane or commands (Stage 22 UI confirmation is out of scope).
    files: ["src/reformat/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/taskpane/*", "**/commands/*"],
              message:
                "reformat/ must not import ui or commands; mutations go through word/revisionAdapter (architecture.md).",
            },
          ],
        },
      ],
    },
  },
  {
    // Enforces docs/architecture.md: ai/providers must not depend on word or ui.
    files: ["src/ai/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/word/*", "**/taskpane/*"],
              message: "ai/ must not depend on word or ui (architecture.md).",
            },
          ],
        },
      ],
    },
  },
  {
    // Enforces docs/architecture.md: ui/* must not import revisionAdapter
    // directly — all mutations go through the orchestrator.
    files: ["src/taskpane/**/*.{ts,tsx}", "src/commands/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/word/revisionAdapter*"],
              message:
                "ui/* must not import revisionAdapter directly; mutations go through the orchestrator (architecture.md).",
            },
          ],
        },
      ],
    },
  },
];
