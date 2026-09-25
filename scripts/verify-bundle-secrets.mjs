import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sentinel = `${["TONE", "FORGE", "SENTINEL"].join("_")}_ABCDEFGHIJKL`;
const builds = [
  { name: "development", config: "webpack.dev.js", mode: "development" },
  { name: "production", config: "webpack.prod.js", mode: "production" },
];

for (const build of builds) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/webpack-cli/bin/cli.js", "--config", build.config, "--mode", build.mode],
    {
      cwd: root,
      env: { ...process.env, OPENAI_API_KEY: sentinel },
      encoding: "utf8",
      shell: false,
    },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${build.name} sentinel build failed`);
  }

  const scan = spawnSync(process.execPath, ["scripts/check-secrets.mjs", "--dist"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (scan.status !== 0) {
    process.stderr.write(scan.stdout ?? "");
    process.stderr.write(scan.stderr ?? "");
    throw new Error(`${build.name} generated artifacts contain a secret-shaped value`);
  }
  process.stdout.write(`${scan.stdout}`);
}
