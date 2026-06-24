#!/usr/bin/env node
// Fails if the PR introduces package-lock.json entries published less than MIN_AGE_DAYS ago.
// True new entries only — compares base vs head lockfile resolutions, not just diff `+` lines,
// so lockfile reorders don't trigger false positives.
// Skips first-party @clickhouse/* packages (no upstream-compromise risk).
// Fails closed on registry errors and on new deps resolved from a non-registry source
// (skip via the 'lockfile-age-skip' PR label).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MIN_AGE_DAYS = Number.parseInt(process.env.MIN_AGE_DAYS ?? "7", 10);
if (!Number.isFinite(MIN_AGE_DAYS) || MIN_AGE_DAYS <= 0) {
  console.error(
    `MIN_AGE_DAYS must be a positive integer (got: ${process.env.MIN_AGE_DAYS ?? "7"})`,
  );
  process.exit(2);
}
const BASE_REF = process.env.GITHUB_BASE_REF || "main";
const cutoffMs = Date.now() - MIN_AGE_DAYS * 86400_000;

// First-party scopes — npm has no native equivalent to yarn's npmPreapprovedPackages,
// so hardcoded here. Mirrors the Dependabot cooldown.exclude list.
const PREAPPROVED_SCOPES = ["@clickhouse/"];

const REGISTRY_HOSTS = ["registry.npmjs.org", "registry.npmmirror.com"];

// Classify an entry's `resolved` field:
//   'registry' — an allowed HTTPS registry tarball; audited against the age gate.
//   'foreign'  — a URL, but not an allowed HTTPS registry host (alternative registry,
//                plain http, git+https, etc.). This is a bypass vector for the age gate,
//                so we fail closed on newly-added foreign entries (escape hatch: the
//                'lockfile-age-skip' PR label).
//   'local'    — no resolved URL at all (workspace source dirs, file: links); not a
//                downloaded artifact, so there is nothing to age-check.
function classifyResolved(resolved) {
  if (!resolved || typeof resolved !== "string") return "local";
  let u;
  try {
    u = new URL(resolved);
  } catch {
    return "local";
  }
  if (u.protocol === "https:" && REGISTRY_HOSTS.includes(u.host))
    return "registry";
  return "foreign";
}

function isPreapproved(name) {
  return PREAPPROVED_SCOPES.some((scope) => name.startsWith(scope));
}

// node_modules/foo                 -> foo
// node_modules/@scope/bar          -> @scope/bar
// node_modules/foo/node_modules/baz -> baz
// node_modules/foo/node_modules/@scope/baz -> @scope/baz
function packageNameFromPath(path) {
  const idx = path.lastIndexOf("node_modules/");
  if (idx === -1) return null;
  return path.slice(idx + "node_modules/".length);
}

function extractNpmResolutions(text) {
  const out = new Map();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON in lockfile: ${err.message}`);
  }
  const version = parsed.lockfileVersion;
  if (version !== 2 && version !== 3) {
    throw new Error(
      `Unsupported lockfileVersion ${version}. This audit handles package-lock.json v2/v3 (npm 7+).`,
    );
  }
  const packages = parsed.packages;
  if (!packages || typeof packages !== "object") return out;
  for (const [path, entry] of Object.entries(packages)) {
    if (path === "") continue; // root project
    if (!entry || typeof entry !== "object") continue;
    if (entry.link === true) continue; // workspace symlinks
    if (!entry.version) continue;
    const kind = classifyResolved(entry.resolved);
    if (kind === "local") continue;
    const name = packageNameFromPath(path);
    if (!name) continue;
    // Key by name@version so multiple paths resolving to the same entry collapse.
    const key = `${name}@${entry.version}`;
    out.set(key, {
      name,
      version: entry.version,
      kind,
      resolved: entry.resolved,
    });
  }
  return out;
}

// Use the merge-base, not the branch tip — what the PR *actually introduced*
// is what's in head but not in the common ancestor with main. Comparing
// against the branch tip would flag stale pins as "new" when they pre-date
// the PR.
let mergeBase;
try {
  mergeBase = execSync(`git merge-base "origin/${BASE_REF}" HEAD`, {
    encoding: "utf8",
  }).trim();
} catch (err) {
  console.error(
    `Could not find merge-base of HEAD and origin/${BASE_REF}: ${err.message}`,
  );
  process.exit(2);
}

let baseLockfile;
try {
  baseLockfile = execSync(`git show "${mergeBase}:package-lock.json"`, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
} catch (err) {
  console.error(
    `Could not read package-lock.json at merge-base ${mergeBase.slice(0, 10)}: ${err.message}`,
  );
  console.error(
    `If package-lock.json is being introduced for the first time, use the 'lockfile-age-skip' label.`,
  );
  process.exit(2);
}
const headLockfile = readFileSync("package-lock.json", "utf8");

let baseResolutions, headResolutions;
try {
  baseResolutions = extractNpmResolutions(baseLockfile);
  headResolutions = extractNpmResolutions(headLockfile);
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

const added = new Map();
for (const [key, value] of headResolutions) {
  if (baseResolutions.has(key)) continue;
  if (isPreapproved(value.name)) continue;
  added.set(key, value);
}

if (added.size === 0) {
  console.log("No new npm resolutions to audit.");
  process.exit(0);
}

console.log(
  `Auditing ${added.size} new lockfile entries against ${MIN_AGE_DAYS}-day age gate.`,
);

const violations = [];
const errors = [];

// Newly-added entries resolved from a non-registry source bypass the age gate entirely,
// so fail closed on them rather than silently ignoring (escape hatch: 'lockfile-age-skip').
const registryEntries = [];
for (const value of added.values()) {
  if (value.kind === "foreign") {
    errors.push(
      `${value.name}@${value.version}: resolved from a non-registry source (${value.resolved}) — not covered by the age gate`,
    );
  } else {
    registryEntries.push(value);
  }
}

async function checkOne({ name, version }) {
  // Scoped names contain '/' which must be percent-encoded for the registry URL.
  // encodeURIComponent handles all unsafe chars (replace('/', ...) only hits the first).
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
    });
  } catch (err) {
    errors.push(`${name}: fetch failed (${err.message})`);
    return;
  }
  if (!res.ok) {
    errors.push(`${name}: registry returned ${res.status}`);
    return;
  }
  let data;
  try {
    data = await res.json();
  } catch {
    errors.push(`${name}: invalid JSON from registry`);
    return;
  }
  const publishedAt = data.time?.[version];
  if (!publishedAt) {
    errors.push(
      `${name}@${version}: missing publish time in registry response`,
    );
    return;
  }
  const publishedMs = new Date(publishedAt).getTime();
  if (publishedMs > cutoffMs) {
    const ageDays = Math.floor((Date.now() - publishedMs) / 86400_000);
    const mergeAfter = new Date(
      publishedMs + MIN_AGE_DAYS * 86400_000,
    ).toISOString();
    violations.push({ name, version, publishedAt, ageDays, mergeAfter });
  }
}

const queue = [...registryEntries];
const CONCURRENCY = 8;
async function worker() {
  while (queue.length) {
    const next = queue.shift();
    if (next) await checkOne(next);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

let failed = false;

if (errors.length > 0) {
  console.error(`\n✗ ${errors.length} issue(s) — failing closed:`);
  for (const e of errors) console.error(`  - ${e}`);
  failed = true;
}

if (violations.length > 0) {
  console.error(
    `\n✗ ${violations.length} entries younger than ${MIN_AGE_DAYS} days:`,
  );
  for (const v of violations) {
    console.error(`  ${v.name}@${v.version}`);
    console.error(`    published: ${v.publishedAt} (${v.ageDays} days ago)`);
    console.error(`    mergeable after: ${v.mergeAfter}`);
  }
  const latestMergeAfter = violations
    .map((v) => v.mergeAfter)
    .sort()
    .at(-1);
  console.error(`\nEarliest this PR can merge: ${latestMergeAfter}`);
  failed = true;
}

if (failed) {
  console.error(
    `\nTo bypass for an urgent security fix, add the 'lockfile-age-skip' label to the PR.`,
  );
  process.exit(1);
}

console.log(`✓ All ${added.size} new entries ≥ ${MIN_AGE_DAYS} days old.`);
