import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "ToneForge_Refactor_Implementation",
]);
const markdownLink = /\[[^\]]+\]\(([^)]+)\)/g;
const errors = [];

function collectMarkdown(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (ignoredDirectories.has(name)) return [];
    const path = resolve(directory, name);
    const stats = statSync(path);
    if (stats.isDirectory()) return collectMarkdown(path);
    return name.toLowerCase().endsWith(".md") ? [path] : [];
  });
}

function localTarget(value) {
  const target = value.trim().replace(/^<|>$/g, "").split("#", 1)[0]?.trim();
  if (!target || /^(?:https?:|mailto:)/.test(target)) return null;
  return target.replace(/:\d+$/, "");
}

for (const absolute of collectMarkdown(root)) {
  const file = relative(root, absolute);
  const text = readFileSync(absolute, "utf8");
  for (const match of text.matchAll(markdownLink)) {
    const target = localTarget(match[1] ?? "");
    if (!target) continue;
    const relativeToDocument = resolve(dirname(absolute), target);
    const relativeToRepository = resolve(root, target);
    if (!existsSync(relativeToDocument) && !existsSync(relativeToRepository)) {
      errors.push(`${file}: missing link target ${target}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Documentation link validation failed:");
  errors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

console.log(
  `Documentation link validation passed for ${collectMarkdown(root).length} Markdown files.`,
);
