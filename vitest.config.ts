import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "build"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: [
        "src/analysis/**/*.ts",
        "src/changes/**/*.ts",
        "src/core/**/*.ts",
        "src/formatting/**/*.ts",
        "src/reformat/**/*.ts",
        "src/rules/**/*.ts",
        "src/shared/**/*.ts",
        "src/style/**/*.ts",
        "src/word/**/*.ts",
        "src/ai/**/*.ts",
        "src/commands/**/*.ts",
      ],
      all: false,
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
    // Must exceed the asyncUtilTimeout (10s) in tests/setup.ts — otherwise a
    // findByRole that takes >5s under parallel load times out before the find
    // completes, producing intermittent "Test timed out in 5000ms" failures.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@tests": path.resolve(__dirname, "tests"),
    },
  },
});
