/**
 * Reproducibility check for a clean dependency install and canonical verify graph.
 * This is intentionally opt-in because it creates and removes a temporary copy;
 * it never removes or mutates the developer checkout's dependencies or dist/.
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const tempRoot = mkdtempSync(join(tmpdir(), "toneforge-clean-install-"));

try {
  for (const file of [
    "package.json",
    "package-lock.json",
    "manifest.json",
    "manifest.xml",
    ".env.example",
    ".nvmrc",
    ".prettierrc.json",
    ".lintstagedrc.cjs",
    "eslint.config.mjs",
    "commitlint.config.cjs",
    "tsconfig.json",
    "tsconfig.build.json",
    "vitest.config.ts",
    "webpack.common.js",
    "webpack.dev.js",
    "webpack.prod.js",
  ]) {
    cpSync(resolve(root, file), resolve(tempRoot, file));
  }
  for (const directory of [
    "src",
    "tests",
    "scripts",
    "assets",
    "docs",
    "plans",
    ".github",
    ".husky",
    ".roo",
    ".cline",
  ]) {
    cpSync(resolve(root, directory), resolve(tempRoot, directory), { recursive: true });
  }
  mkdirSync(resolve(tempRoot, "ToneForge_Refactor_Implementation/docs"), { recursive: true });
  for (const file of [
    "ToneForge_REPOSITORY_REVIEW_FINDINGS_AND_PROPOSED_CHANGES.md",
    "ToneForge_STAGE_BY_STAGE_FILE_BY_FILE_REVIEW.md",
    "ToneForge_LATEST_COMMIT_THOROUGH_REVIEW.md",
    "ROADMAP.md",
  ]) {
    cpSync(
      resolve(root, "ToneForge_Refactor_Implementation", file),
      resolve(tempRoot, "ToneForge_Refactor_Implementation", file),
    );
  }
  cpSync(
    resolve(root, "ToneForge_Refactor_Implementation/docs/INDEX.md"),
    resolve(tempRoot, "ToneForge_Refactor_Implementation/docs/INDEX.md"),
  );
  mkdirSync(resolve(tempRoot, ".git"), { recursive: true });
  cpSync(resolve(root, ".git/config"), resolve(tempRoot, ".git/config"));
  writeFileSync(resolve(tempRoot, "ROADMAP.md"), readFileSync(resolve(root, "ROADMAP.md"), "utf8"));
  writeFileSync(resolve(tempRoot, "README.md"), readFileSync(resolve(root, "README.md"), "utf8"));
  writeFileSync(
    resolve(tempRoot, ".prettierignore"),
    ".roo/mcp.json\nToneForge_Refactor_Implementation/\n",
  );
  if (packageJson.scripts?.verify !== "npm run stage:verify") {
    throw new Error("package.json verify must delegate to the named verification graph");
  }
  execSync("npm ci", { cwd: tempRoot, stdio: "inherit", shell: true });
  execSync("npm run verify", { cwd: tempRoot, stdio: "inherit", shell: true });
  console.log("Clean-install reproducibility check passed.");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
