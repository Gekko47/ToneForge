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
];
