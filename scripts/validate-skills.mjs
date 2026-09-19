/**
 * Validate Zoo/Roo Code agent skills for ToneForge.
 * Checks Agent Skills spec compliance:
 * - .roo/skills/<skill-name>/SKILL.md exists
 * - YAML frontmatter with name + description
 * - name matches directory (lowercase alphanumeric + hyphens, 1-64 chars)
 * - description 1-1024 chars
 * - referenced local files exist
 * - no legacy flat .roo/skills/*.md files remain
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const skillsDir = join(root, ".roo", "skills");

const NAME_RE = /^[a-z0-9-]+$/;
let failures = 0;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  failures += 1;
}
function pass(msg) {
  console.log(`PASS: ${msg}`);
}

function parseFrontmatter(text, file) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) {
    fail(`${file}: missing YAML frontmatter (--- name/description ---)`);
    return null;
  }
  const body = m[1];
  const data = {};
  for (const line of body.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    data[key] = value;
  }
  return { data, content: text.slice(m[0].length) };
}

function extractRefs(markdown) {
  const refs = new Set();
  // Match `path/to/file.ext` in backticks with a file extension.
  const re = /`([A-Za-z0-9_.\-$/]+\.[A-Za-z0-9]+)`/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const p = m[1];
    // Skip bare filenames, URLs, and placeholders with < >.
    if (p.includes("://") || p.includes("<") || p.includes(">")) continue;
    if (!p.includes("/")) continue;
    // Skip planned-but-not-yet-scaffolded prefixes documented as planned.
    refs.add(p);
  }
  return [...refs];
}

if (!existsSync(skillsDir)) {
  fail(`skills directory missing: .roo/skills/`);
  process.exit(1);
}

const entries = readdirSync(skillsDir);
const dirs = entries.filter((e) => {
  try {
    return statSync(join(skillsDir, e)).isDirectory();
  } catch {
    return false;
  }
});
const legacyFlat = entries.filter((e) => e.endsWith(".md"));

if (legacyFlat.length > 0) {
  fail(
    `legacy flat skill files present (migrate to <name>/SKILL.md and delete): ${legacyFlat.join(", ")}`,
  );
} else {
  pass("no legacy flat .roo/skills/*.md files");
}

if (dirs.length === 0) {
  fail("no skill directories found under .roo/skills/");
}

const expected = ["toneforge-scaffold", "toneforge-officejs", "toneforge-llm", "toneforge-testing"];
for (const name of expected) {
  if (!dirs.includes(name)) fail(`expected skill directory missing: .roo/skills/${name}/`);
  else pass(`skill directory exists: .roo/skills/${name}/`);
}

for (const dir of dirs) {
  const skillFile = join(skillsDir, dir, "SKILL.md");
  const label = `.roo/skills/${dir}/SKILL.md`;
  if (!existsSync(skillFile)) {
    fail(`${label}: SKILL.md missing`);
    continue;
  }
  const text = readFileSync(skillFile, "utf8");
  const parsed = parseFrontmatter(text, label);
  if (!parsed) continue;
  const { data, content } = parsed;

  // name checks
  if (!data.name) fail(`${label}: frontmatter 'name' missing`);
  else {
    if (data.name !== dir)
      fail(`${label}: frontmatter name '${data.name}' must match directory '${dir}'`);
    else pass(`${label}: name matches directory`);
    if (!NAME_RE.test(data.name))
      fail(`${label}: name '${data.name}' must be lowercase alphanumeric + hyphens`);
    if (data.name.length < 1 || data.name.length > 64)
      fail(`${label}: name length must be 1-64 chars`);
  }

  // description checks
  if (!data.description) fail(`${label}: frontmatter 'description' missing`);
  else {
    const len = data.description.length;
    if (len < 1 || len > 1024) fail(`${label}: description length ${len} must be 1-1024 chars`);
    else pass(`${label}: description present (${len} chars)`);
    if (!/use when/i.test(data.description)) {
      console.warn(
        `WARN: ${label}: description should state when to use the skill ("Use when ...")`,
      );
    }
  }

  if (content.trim().length < 200)
    fail(`${label}: body too short — add instructions, triggers, and resources`);
  else pass(`${label}: body length ok (${content.trim().length} chars)`);

  if (!/when to use/i.test(content)) fail(`${label}: body should contain a "When to use" section`);
  if (!/referenced resources|resources/i.test(content))
    console.warn(`WARN: ${label}: consider a Referenced resources section`);

  // Referenced file existence (best-effort; planned paths are allowed if documented as planned).
  const refs = extractRefs(content);
  const plannedPrefixes = [
    "src/rules/",
    "src/formatting/",
    "src/style/",
    "src/analysis/",
    "src/changes/",
    "src/ui/",
  ];
  for (const ref of refs) {
    const isPlanned = plannedPrefixes.some((p) => ref.startsWith(p));
    const abs = join(root, ref);
    if (existsSync(abs)) continue;
    if (isPlanned && /planned/i.test(content)) continue; // documented as planned
    // Allow directory prefixes without exact file (e.g. src/ai/prompts/).
    if (ref.endsWith("/")) {
      if (existsSync(abs)) continue;
    }
    fail(`${label}: referenced path missing: ${ref}`);
  }
  pass(`${label}: referenced paths checked (${refs.length} refs)`);
}

if (failures > 0) {
  console.error(`\n${failures} skill validation failure(s).`);
  process.exit(1);
}
console.log(
  "\nAll skill checks passed — skills are discoverable (SKILL.md + frontmatter) and references resolve.",
);
