#!/usr/bin/env node
/**
 * @description Prepares a release: sets the version in the three package.json files, commits and tags it.
 * Pushing the tag then lets the CI test, publish the Docker image and create the GitHub release.
 * @example pnpm release 2.1.0
 * @example pnpm release 2.1.0-rc.1
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FILES = ["package.json", "api/package.json", "web/package.json"];

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

/**
 * @description Stops with a message, without a stack trace.
 * @param {string} message
 */
function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) fail("Usage: pnpm release <version>, e.g. pnpm release 2.1.0");
const tag = `v${version}`;

if (git("status", "--porcelain")) fail("The working tree is not clean: commit or stash first.");
if (git("tag", "--list", tag)) fail(`Tag ${tag} already exists.`);
const current = JSON.parse(readFileSync("package.json", "utf8")).version;
if (current === version) fail(`The version is already ${version}.`);

// Only the "version" line changes, the rest of each file is left as is.
for (const file of FILES) {
  const text = readFileSync(file, "utf8");
  const next = text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
  if (next === text) fail(`No "version" field in ${file}.`);
  writeFileSync(file, next);
}

git("add", ...FILES);
git("commit", "-m", `chore(release): ${tag}`);
git("tag", "-a", tag, "-m", tag);

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
console.log(`✓ ${current} → ${version}, commit and tag ${tag} created.`);
console.log(`Publish it with: git push origin ${branch} ${tag}`);
