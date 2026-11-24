// Last step of `npm run build:release`: checks dist/ is safe to hand out, then zips it to
// release/hybrid-phish-guard-<version>.zip (a zip Chrome can load after unzipping).
//
// Fails the build if:
// - the App Check debug token from .env appears anywhere in dist/ (it's a secret);
// - sourcemaps are present (they'd ship the full source tree; release builds skip them);
// - the Firebase web config is missing (the zip would have no working cloud model).
// Never prints secret values, only which check failed and where.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const fail = (msg: string): never => {
  console.error(`release check failed: ${msg}`);
  process.exit(1);
};

function readEnv(): Record<string, string> {
  const path = join(root, ".env");
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

if (!existsSync(join(dist, "manifest.json"))) fail("dist/manifest.json missing; run the release build first");
const env = readEnv();
const all = files(dist);

const maps = all.filter((f) => f.endsWith(".map"));
if (maps.length) fail(`sourcemaps in dist/ (${maps.map((f) => relative(root, f)).join(", ")})`);

const token = env.VITE_APPCHECK_DEBUG_TOKEN;
if (token) {
  const leaked = all.filter((f) => readFileSync(f).includes(token));
  if (leaked.length) fail(`App Check debug token found in ${leaked.map((f) => relative(root, f)).join(", ")}`);
}

const required = ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID"];
const missing = required.filter((k) => !(process.env[k] || env[k]));
if (missing.length) fail(`Firebase config missing (${missing.join(", ")}); the cloud model wouldn't work`);

const { version } = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8")) as { version: string };
const outDir = join(root, "release");
const zip = join(outDir, `hybrid-phish-guard-${version}.zip`);
mkdirSync(outDir, { recursive: true });
rmSync(zip, { force: true }); // only ever the file this script generates
execFileSync("zip", ["-q", "-r", "-X", zip, "."], { cwd: dist });

const kb = Math.round(statSync(zip).size / 1024);
console.log(`release checks passed (${all.length} files, no sourcemaps${token ? ", no debug token" : ""})`);
console.log(`wrote ${relative(root, zip)} (${kb} KB)`);
