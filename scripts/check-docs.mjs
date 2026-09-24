import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["README.md", "ROADMAP.md", "docs/project-state.md", "docs/architecture.md"];
const markdownLink = /\[[^\]]+\]\(([^)]+)\)/g;
const errors = [];

for (const file of files) {
  const absolute = resolve(root, file);
  const text = readFileSync(absolute, "utf8");
  for (const match of text.matchAll(markdownLink)) {
    const target = match[1]?.split("#")[0]?.trim();
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    const targetPath = resolve(dirname(absolute), target);
    if (!existsSync(targetPath)) {
      errors.push(`${file}: missing link target ${target}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Documentation link validation failed:");
  errors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

console.log("Documentation link validation passed.");
