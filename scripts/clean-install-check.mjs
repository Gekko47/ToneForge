/**
 * Reproducibility check for a clean dependency install and canonical verify graph.
 * This is intentionally opt-in because it creates and removes a temporary copy;
 * it never removes or mutates the developer checkout's dependencies or dist/.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tempRoot = mkdtempSync(join(tmpdir(), "toneforge-clean-install-"));
const archivePath = join(tempRoot, ".toneforge-repository.tar");

try {
  execFileSync("git", ["archive", "--format=tar", "--output", archivePath, "HEAD"], {
    cwd: root,
    stdio: "inherit",
  });
  execFileSync("tar", ["-xf", archivePath, "-C", tempRoot], { stdio: "inherit" });
  rmSync(archivePath, { force: true });
  const packageJson = JSON.parse(readFileSync(resolve(tempRoot, "package.json"), "utf8"));
  if (packageJson.scripts?.verify !== "npm run stage:verify") {
    throw new Error("package.json verify must delegate to the named verification graph");
  }
  execSync("npm ci", { cwd: tempRoot, stdio: "inherit", shell: true });
  execSync("npm run verify", { cwd: tempRoot, stdio: "inherit", shell: true });
  console.log("Clean-install reproducibility check passed.");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
