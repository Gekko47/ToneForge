import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const allowedExternalScripts = new Set([
  "https://officeapis.public.onecdn.static.microsoft/1/office.js",
  "https://appsforoffice.microsoft.com/lib/1/hosted/office.js",
]);

const root = resolve(process.cwd());
const requiredFiles = [
  "manifest.json",
  "manifest.xml",
  "taskpane.html",
  "commands.html",
  "assets/icon-16.png",
  "assets/icon-32.png",
  "assets/icon-80.png",
];

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function assertFile(staging, file) {
  const path = resolve(staging, file);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`Release package is missing file: ${file}`);
  }
  return path;
}

function validateManifestReferences(staging, manifest) {
  const iconPaths = Object.values(manifest.icons ?? {}).filter(
    (value) => typeof value === "string" && !/^https?:\/\//.test(value),
  );
  for (const iconPath of iconPaths) assertFile(staging, iconPath);
  for (const extension of manifest.extensions ?? []) {
    for (const runtime of extension.runtimes ?? []) {
      const page = runtime?.code?.page;
      if (typeof page !== "string") throw new Error("Manifest runtime is missing code.page");
      if (/^https?:\/\//.test(page)) {
        const pathname = new URL(page).pathname.replace(/^\//, "");
        if (pathname && pathname !== "taskpane.html" && pathname !== "commands.html") {
          assertFile(staging, pathname);
        }
      }
    }
  }
}

function validateHtmlBundles(staging, page) {
  const path = assertFile(staging, page);
  const html = readFileSync(path, "utf8");
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => match[1]);
  if (scripts.length === 0) throw new Error(`${page} has no bundled script reference`);
  const localScripts = [];
  for (const script of scripts) {
    if (/^https?:\/\//.test(script)) {
      if (!allowedExternalScripts.has(script)) {
        throw new Error(`${page} references an unapproved external script: ${script}`);
      }
      continue;
    }
    if (!/\.[a-f0-9]{8,}\.js$/.test(script)) {
      throw new Error(`${page} references a non-content-hashed bundle: ${script}`);
    }
    assertFile(staging, script);
    localScripts.push(script);
  }
  if (localScripts.length === 0) throw new Error(`${page} has no local content-hashed bundle`);
  return localScripts;
}

function validateXml(staging, sourceXml) {
  const stagedXml = readFileSync(assertFile(staging, "manifest.xml"), "utf8");
  if (stagedXml !== sourceXml)
    throw new Error("Staged manifest.xml differs from source manifest.xml");
  for (const asset of ["icon-16.png", "icon-32.png", "icon-80.png"]) {
    if (!stagedXml.includes(`assets/${asset}`))
      throw new Error(`manifest.xml does not reference ${asset}`);
  }
  for (const page of ["taskpane.html", "commands.html"]) {
    if (!stagedXml.includes(page)) throw new Error(`manifest.xml does not reference ${page}`);
  }
}

export function checkReleasePackage(staging = resolve(root, "build/release")) {
  if (!existsSync(staging)) {
    throw new Error("build/release is missing; run npm run release:package first");
  }
  for (const file of requiredFiles) assertFile(staging, file);

  const sourceManifest = readJson(resolve(root, "manifest.json"), "source manifest.json");
  const stagedManifestPath = assertFile(staging, "manifest.json");
  const stagedManifest = readJson(stagedManifestPath, "staged manifest.json");
  if (JSON.stringify(stagedManifest) !== JSON.stringify(sourceManifest)) {
    throw new Error("Staged manifest.json differs from source manifest.json");
  }
  validateManifestReferences(staging, stagedManifest);
  validateXml(staging, readFileSync(resolve(root, "manifest.xml"), "utf8"));

  const javascript = readdirSync(staging).filter((file) => file.endsWith(".js"));
  if (javascript.length === 0) throw new Error("Release package contains no JavaScript bundles");
  if (javascript.some((file) => !/\.[a-f0-9]{8,}\.js$/.test(file))) {
    throw new Error("Release package contains a non-content-hashed JavaScript bundle");
  }
  const referenced = new Set([
    ...validateHtmlBundles(staging, "taskpane.html"),
    ...validateHtmlBundles(staging, "commands.html"),
  ]);
  if (referenced.size === 0) throw new Error("Release package has no local entry bundles");
  return {
    staging,
    requiredFiles,
    javascriptCount: javascript.length,
    referencedBundles: [...referenced],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/check-release-package.mjs")) {
  const result = checkReleasePackage();
  console.log(
    `Release package check passed: ${result.requiredFiles.length} required files and ${result.javascriptCount} content-hashed JavaScript bundles.`,
  );
}
