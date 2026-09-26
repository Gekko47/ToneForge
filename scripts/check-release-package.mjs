import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildProductionManifest,
  findDevelopmentArtifacts,
  validateProductionOrigin,
} from "./production-manifest.mjs";

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

/**
 * The `manifest.xml` a package is expected to carry.
 *
 * Same rule as the JSON manifest: identical to source for a local package, and
 * derived from it when a production origin is configured. Enforcing raw source
 * equality in production mode would reject the one package that is allowed to
 * ship.
 */
function expectedXml(sourceXml, sourceManifest, productionOrigin) {
  if (!productionOrigin) return sourceXml;
  const source = sourceManifest.validDomains?.[0];
  if (typeof source !== "string" || source.length === 0) {
    throw new Error("Development manifest has no validDomains[0] to substitute.");
  }
  const expected = sourceXml.split(source).join(new URL(productionOrigin.trim()).origin);
  // The substitution is textual, so the result is only trustworthy once it has
  // been checked. A development value the source string did not match — a second
  // loopback host, a plaintext-HTTP origin — would otherwise be blessed as
  // "expected" here and shipped, and nothing downstream re-reads the XML.
  const remaining = findXmlDevelopmentArtifacts(expected);
  if (remaining.length > 0) {
    const detail = remaining.map((item) => item.reason).join(", ");
    throw new Error(`Expected manifest.xml contains development values: ${detail}`);
  }
  return expected;
}

/**
 * Development-shaped values still present in a rewritten `manifest.xml`.
 *
 * XML namespace declarations are `http://` by specification and are not origins,
 * so they are removed before the scan. A blanket plaintext-HTTP check would
 * reject every well-formed manifest, including the one production build.
 */
function findXmlDevelopmentArtifacts(xml) {
  const scannable = xml.replace(/\sxmlns(:[\w.-]+)?="[^"]*"/g, "");
  const found = findDevelopmentArtifacts(scannable);
  if (!/http:\/\//i.test(scannable)) return found;
  return [{ path: "manifest.xml", value: "http://…", reason: "plaintext HTTP origin" }, ...found];
}

function validateXml(staging, expected) {
  const stagedXml = readFileSync(assertFile(staging, "manifest.xml"), "utf8");
  if (stagedXml !== expected)
    throw new Error("Staged manifest.xml differs from the expected manifest.xml");
  for (const asset of ["icon-16.png", "icon-32.png", "icon-80.png"]) {
    if (!stagedXml.includes(`assets/${asset}`))
      throw new Error(`manifest.xml does not reference ${asset}`);
  }
  for (const page of ["taskpane.html", "commands.html"]) {
    if (!stagedXml.includes(page)) throw new Error(`manifest.xml does not reference ${page}`);
  }
}

/**
 * Validate a generated production manifest.
 *
 * Separate from `checkReleasePackage` because the checked-in manifest must
 * stay on localhost for `npm run sideload`. This runs only when a deployment
 * origin is supplied, so the local release path keeps working untouched.
 */
export function checkProductionManifest(manifest, productionOrigin) {
  const problems = validateProductionOrigin(productionOrigin);
  if (problems.length > 0) {
    throw new Error(`Production origin is not acceptable: ${problems.join(" ")}`);
  }
  const artifacts = findDevelopmentArtifacts(manifest);
  if (artifacts.length > 0) {
    const detail = artifacts.map((item) => `${item.path} (${item.reason})`).join(", ");
    throw new Error(`Production manifest contains development values: ${detail}`);
  }
  return { productionOrigin, developmentArtifacts: [] };
}

export function checkReleasePackage(staging = resolve(root, "build/release")) {
  if (!existsSync(staging)) {
    throw new Error("build/release is missing; run npm run release:package first");
  }
  for (const file of requiredFiles) assertFile(staging, file);

  const sourceManifest = readJson(resolve(root, "manifest.json"), "source manifest.json");
  const stagedManifestPath = assertFile(staging, "manifest.json");
  const stagedManifest = readJson(stagedManifestPath, "staged manifest.json");
  // The checked-in manifest is deliberately localhost so `npm run sideload`
  // works. That is fine for a local package and must never be shipped, so when
  // a deployment origin is configured the staged manifest is compared against
  // the manifest derived from that origin rather than the source file: raw
  // source equality would reject exactly the package that is allowed to ship.
  const productionOrigin = process.env.TONEFORGE_PRODUCTION_ORIGIN;
  const expectedManifest = productionOrigin
    ? buildProductionManifest(sourceManifest, productionOrigin)
    : sourceManifest;
  if (JSON.stringify(stagedManifest) !== JSON.stringify(expectedManifest)) {
    throw new Error(
      productionOrigin
        ? "Staged manifest.json differs from the expected production manifest"
        : "Staged manifest.json differs from source manifest.json",
    );
  }
  if (productionOrigin) {
    checkProductionManifest(stagedManifest, productionOrigin);
  }
  validateManifestReferences(staging, stagedManifest);
  validateXml(
    staging,
    expectedXml(
      readFileSync(resolve(root, "manifest.xml"), "utf8"),
      sourceManifest,
      productionOrigin,
    ),
  );

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
