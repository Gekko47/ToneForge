import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ignoredDirectories = new Set([
  ".git",
  ".husky",
  "coverage",
  "dist",
  "node_modules",
  "ToneForge_Refactor_Implementation",
]);
const allowedExtensions = new Set([".cjs", ".json", ".md", ".mjs", ".ts", ".tsx", ".yml", ".yaml"]);
const patterns = [
  /sk-[A-Za-z0-9]{20,}/,
  /pk-[A-Za-z0-9]{20,}/,
  /rk-[A-Za-z0-9]{20,}/,
  /whsec_[A-Za-z0-9]{20,}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const errors = [];

function visit(directory) {
  for (const name of readdirSync(directory)) {
    if (ignoredDirectories.has(name)) continue;
    const path = join(directory, name);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      visit(path);
      continue;
    }
    if (!allowedExtensions.has(extname(path))) continue;
    const text = readFileSync(path, "utf8");
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        errors.push(`${relative(root, path)} contains a likely secret pattern`);
      }
    }
  }
}

visit(root);
if (errors.length > 0) {
  console.error("Secret scan failed:");
  errors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}
console.log("Secret scan passed.");
