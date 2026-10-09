/**
 * Validate agent skills for ToneForge.
 * Checks Agent Skills spec compliance:
 * - <root>/skills/<skill-name>/SKILL.md exists for each configured root
 * - YAML frontmatter with name + description
 * - name matches directory (lowercase alphanumeric + hyphens, 1-64 chars)
 * - description 1-1024 chars and states when to use the skill
 * - referenced local files exist
 * - no legacy flat skills/*.md files remain
 *
 * Both `.cline/skills` and `.roo/skills` are validated. They are kept in sync,
 * so a skill that drifts in one is a defect the other will eventually inherit.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

/**
 * Each skill root is validated independently, with its own expected set.
 *
 * `.cline` is the primary set Cline loads; `.roo` is the Roo Code equivalent.
 * They are deliberately near-identical rather than one referencing the other, so
 * a reader working in either tool gets a complete instruction set instead of
 * following a pointer.
 */
const SKILL_ROOTS = [
  {
    label: ".cline/skills",
    dir: join(root, ".cline", "skills"),
    expected: [
      "toneforge-scaffold",
      "toneforge-architecture",
      "toneforge-officejs",
      "toneforge-llm",
      "toneforge-testing",
      "toneforge-consistency",
    ],
  },
  {
    label: ".roo/skills",
    dir: join(root, ".roo", "skills"),
    expected: ["toneforge-scaffold", "toneforge-officejs", "toneforge-llm", "toneforge-testing"],
  },
];

const NAME_RE = /^[a-z0-9-]+$/;
let failures = 0;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  failures += 1;
}
function pass(msg) {
  console.log(`PASS: ${msg}`);
}

/**
 * A YAML block-scalar indicator (`>`, `>-`, `|`, `|-`, `|+`) opens a multi-line
 * value whose text lives on the following, more-indented lines. Reading only the
 * indicator line silently truncates the value to `>-`, which is how a folded
 * description once parsed as two characters and failed the "use when" check.
 */
const BLOCK_SCALAR_RE = /^[>|][+-]?$/;

export function parseFrontmatter(text, file) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) {
    fail(`${file}: missing YAML frontmatter (--- name/description ---)`);
    return null;
  }
  const body = m[1];
  const data = {};
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (BLOCK_SCALAR_RE.test(value)) {
      // Fold the continuation lines into one value. A blank line is skipped
      // rather than treated as the end of the value, so a paragraph break does
      // not truncate the description.
      const parts = [];
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        if (/^\s+\S/.test(next)) {
          parts.push(next.trim());
          i += 1;
          continue;
        }
        if (next.trim() === "") {
          i += 1;
          continue;
        }
        break;
      }
      data[key] = parts.join(" ");
      continue;
    }
    data[key] = value;
  }
  return { data, content: text.slice(m[0].length) };
}

function extractRefs(markdown) {
  const refs = new Set();
  const re = /(?:`|\]\()([A-Za-z0-9_.\-$/]+\.[A-Za-z0-9]+)(?::\d+)?(?:`|\))/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const p = m[1];
    if (p.includes("://") || p.includes("<") || p.includes(">")) continue;
    if (!p.includes("/")) continue;
    refs.add(p);
  }
  return [...refs];
}

function main() {
  const MISSING_DIRS = new Set();

  for (const { label: rootLabel, dir: skillsDir, expected } of SKILL_ROOTS) {
    if (!existsSync(skillsDir)) {
      fail(`skills directory missing: ${rootLabel}/`);
      MISSING_DIRS.add(rootLabel);
      continue;
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
      pass(`no legacy flat ${rootLabel}/*.md files`);
    }

    if (dirs.length === 0) {
      fail(`no skill directories found under ${rootLabel}/`);
    }

    for (const name of expected) {
      if (!dirs.includes(name)) fail(`expected skill directory missing: ${rootLabel}/${name}/`);
      else pass(`skill directory exists: ${rootLabel}/${name}/`);
    }

    for (const dir of dirs) {
      const skillFile = join(skillsDir, dir, "SKILL.md");
      const label = `${rootLabel}/${dir}/SKILL.md`;
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

      if (!/when to use/i.test(content))
        fail(`${label}: body should contain a "When to use" section`);
      if (!/referenced resources|resources/i.test(content))
        console.warn(`WARN: ${label}: consider a Referenced resources section`);

      // Referenced file existence. A reference must resolve relative to the skill
      // or to the repository root, so a skill that names a file has to name a file
      // that exists. No planned-path allowance remains: every module these skills
      // reference is implemented, and a skill pointing at a directory that was
      // never built is a documentation defect, not a forward-looking note.
      const refs = extractRefs(content);
      const contentDirectory = dirname(skillFile);
      for (const ref of refs) {
        const abs = resolve(contentDirectory, ref);
        if (existsSync(abs)) continue;
        const repositoryRelative = resolve(root, ref);
        if (existsSync(repositoryRelative)) continue;
        fail(`${label}: referenced path missing: ${ref}`);
      }
      pass(`${label}: referenced paths checked (${refs.length} refs)`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} skill validation failure(s).`);
    process.exit(1);
  }
  const validated =
    MISSING_DIRS.size === 0 ? SKILL_ROOTS.length : SKILL_ROOTS.length - MISSING_DIRS.size;
  console.log(
    `\nAll skill checks passed — ${validated} skill root(s) validated: skills are discoverable (SKILL.md + frontmatter) and references resolve.`,
  );
}

// Guarded so the parser can be imported by tests without running the whole
// validation, matching check-release-package.mjs and verify-bundle-secrets.mjs.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
