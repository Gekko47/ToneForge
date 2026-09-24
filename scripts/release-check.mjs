import { readFileSync } from "node:fs";

const roadmap = readFileSync(new URL("../ROADMAP.md", import.meta.url), "utf8");
const manual = readFileSync(new URL("../docs/manual-verification.md", import.meta.url), "utf8");
const errors = [];

const requiredStatuses = new Map([
  ["01", "PASS"],
  ["18", "PASS"],
  ["26", "PASS"],
  ["27", "PASS"],
  ["28", "PASS"],
]);
for (const [stage, required] of requiredStatuses) {
  const line = roadmap.split("\n").find((candidate) => candidate.startsWith(`| ${stage} `));
  if (!line || !line.includes(`| ${required} |`)) {
    errors.push(`Stage ${stage} must be ${required} in the canonical roadmap`);
  }
}

const requiredHosts = ["Word on Windows", "Word on the web (Chrome)", "Word on the web (Edge)"];
for (const host of requiredHosts) {
  const line = manual.split("\n").find((candidate) => candidate.includes(`| ${host} |`));
  if (!line || /\b(PENDING|PARTIAL|FAIL)\b/.test(line)) {
    errors.push(`Manual host evidence is incomplete: ${host}`);
  }
}

if (/\b(FAIL|BLOCKED)\b/.test(manual)) {
  errors.push("Manual verification records a failed or blocked host");
}

if (errors.length > 0) {
  console.error("Release check failed:");
  errors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}
console.log("Release check passed.");
