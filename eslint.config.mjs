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
    // Enforces docs/architecture.md: core/domain may only import zod and
    // shared/utils — never word, ai, ui, or Office (see ADR-0013).
    files: ["src/core/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/word/*", "**/ai/*", "**/taskpane/*", "**/commands/*"],
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
              group: ["**/ai/*", "**/word/*", "**/taskpane/*", "**/commands/*"],
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
              group: ["**/ai/*", "**/word/*", "**/taskpane/*", "**/commands/*"],
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
                "**/analysis/*",
                "**/rules/*",
                "**/formatting/*",
                "**/style/*",
                "**/ai/*",
                "**/word/*",
                "**/taskpane/*",
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
