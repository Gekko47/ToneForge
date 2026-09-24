import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = resolve(root, "dist");
const staging = resolve(root, "build/release");

if (!existsSync(dist)) {
  throw new Error("dist/ is missing; run npm run build first");
}

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
cpSync(dist, staging, { recursive: true });
for (const file of ["manifest.json", "manifest.xml", "assets"]) {
  cpSync(resolve(root, file), resolve(staging, file), { recursive: true });
}

console.log("Release staging created at build/release.");
