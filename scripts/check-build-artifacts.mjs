import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = join(root, "dist");
const maxJavaScriptBytes = 600 * 1024;
const expectedEntries = ["runtime", "taskpane", "commands"];
const allowedExternalScripts = new Set([
  "https://officeapis.public.onecdn.static.microsoft/1/office.js",
  "https://appsforoffice.microsoft.com/lib/1/hosted/office.js",
]);

if (!existsSync(dist)) {
  throw new Error("dist/ is missing; run npm run build first");
}

const files = readdirSync(dist).map((name) => ({ name, path: join(dist, name) }));
const javascript = files.filter(({ name }) => name.endsWith(".js"));
const oversized = javascript.filter(({ path }) => statSync(path).size > maxJavaScriptBytes);
if (oversized.length > 0) {
  throw new Error(
    `JavaScript asset budget exceeded (${maxJavaScriptBytes} bytes): ${oversized
      .map(({ name, path }) => `${name} (${statSync(path).size})`)
      .join(", ")}`,
  );
}

for (const entry of expectedEntries) {
  const entryFile = javascript.find(
    ({ name }) => name.startsWith(`${entry}.`) && name.includes("."),
  );
  if (!entryFile) throw new Error(`Missing production entry chunk for ${entry}`);
}

for (const page of ["taskpane.html", "commands.html"]) {
  const pagePath = join(dist, page);
  if (!existsSync(pagePath)) throw new Error(`Missing production page: ${page}`);
  const html = readFileSync(pagePath, "utf8");
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => match[1]);
  if (scripts.length === 0) throw new Error(`${page} has no production script tags`);
  for (const script of scripts) {
    if (script.startsWith("http://") || script.startsWith("https://")) {
      if (!allowedExternalScripts.has(script)) {
        throw new Error(`${page} must not depend on an external JavaScript bundle: ${script}`);
      }
      continue;
    }
    if (!existsSync(resolve(dist, script))) {
      throw new Error(`${page} references missing bundle: ${script}`);
    }
  }
  const initialBytes = scripts.reduce(
    (total, script) =>
      script.startsWith("http://") || script.startsWith("https://")
        ? total
        : total + statSync(resolve(dist, script)).size,
    0,
  );
  if (initialBytes > maxJavaScriptBytes) {
    throw new Error(
      `${page} initial JavaScript budget exceeded (${maxJavaScriptBytes} bytes): ${initialBytes}`,
    );
  }
}

const hashedJavaScript = javascript.every(({ name }) => /\.[a-f0-9]{8,}\.js$/.test(name));
if (!hashedJavaScript) throw new Error("All production JavaScript assets must be content-hashed");

console.log(
  `Build artifact check passed: ${javascript.length} hashed JavaScript assets; ` +
    `max JavaScript budget ${maxJavaScriptBytes} bytes.`,
);
