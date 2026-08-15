#!/usr/bin/env node
/** Download a pinned Tectonic build into resources/tectonic/<platform>-<arch>/. */

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TECTONIC_VERSION = "0.17.0";
const TAG = `tectonic@${TECTONIC_VERSION}`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ENGINES = {
  "win32-x64": {
    asset: `tectonic-${TECTONIC_VERSION}-x86_64-pc-windows-msvc.zip`,
    binary: "tectonic.exe",
    unpacked: ["release/win-unpacked/resources/tectonic/win32-x64/tectonic.exe"],
  },
  "linux-x64": {
    asset: `tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz`,
    binary: "tectonic",
    unpacked: ["release/linux-unpacked/resources/tectonic/linux-x64/tectonic"],
  },
  "darwin-arm64": {
    asset: `tectonic-${TECTONIC_VERSION}-aarch64-apple-darwin.tar.gz`,
    binary: "tectonic",
    unpacked: [
      "release/mac-arm64/MedPrism.app/Contents/Resources/tectonic/darwin-arm64/tectonic",
      "release/mac/MedPrism.app/Contents/Resources/tectonic/darwin-arm64/tectonic",
    ],
  },
};

function hostKey() {
  return `${process.platform}-${process.arch}`;
}

function findFile(root, name) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === name) return full;
    }
  }
  return null;
}

function destPath(key) {
  const engine = ENGINES[key];
  if (!engine) throw new Error(`Unsupported Tectonic platform: ${key}`);
  return path.join(ROOT, "resources", "tectonic", key, engine.binary);
}

export async function fetchTectonic(key, { force = false } = {}) {
  const engine = ENGINES[key];
  if (!engine) throw new Error(`Unsupported Tectonic platform: ${key}`);
  const dest = destPath(key);
  if (!force && existsSync(dest) && statSync(dest).size > 1_000_000) {
    console.log(`Tectonic ${TECTONIC_VERSION} already present: ${dest}`);
    return dest;
  }

  const url = `https://github.com/tectonic-typesetting/tectonic/releases/download/${encodeURIComponent(TAG)}/${engine.asset}`;
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Tectonic download failed: ${response.status} ${url}`);

  const work = mkdtempSync(path.join(tmpdir(), "medprism-tectonic-"));
  try {
    const archive = path.join(work, engine.asset);
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    const extracted = path.join(work, "out");
    mkdirSync(extracted);
    const tar = spawnSync("tar", ["-xf", archive, "-C", extracted], { stdio: "inherit" });
    if (tar.status !== 0) throw new Error(`tar failed to extract ${engine.asset}`);
    const found = findFile(extracted, engine.binary);
    if (!found) throw new Error(`${engine.binary} missing from ${engine.asset}`);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(found, dest);
    if (process.platform !== "win32") chmodSync(dest, 0o755);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  if (statSync(dest).size < 1_000_000) throw new Error(`Downloaded Tectonic is too small: ${dest}`);
  if (key === hostKey()) {
    const probe = spawnSync(dest, ["--version"], { encoding: "utf8" });
    if (probe.status !== 0) throw new Error(`Bundled Tectonic failed --version: ${probe.stderr || probe.stdout}`);
    console.log(String(probe.stdout || probe.stderr).trim());
  }
  console.log(`Installed ${dest}`);
  return dest;
}

export function assertUnpackedTectonic(key) {
  const engine = ENGINES[key];
  if (!engine) throw new Error(`Unsupported Tectonic platform: ${key}`);
  const found = engine.unpacked
    .map((relative) => path.join(ROOT, relative))
    .find((candidate) => existsSync(candidate) && statSync(candidate).size > 1_000_000);
  if (!found) {
    throw new Error(`Packaged Tectonic missing for ${key}. Looked in:\n${engine.unpacked.join("\n")}`);
  }
  console.log(`Packaged Tectonic present: ${found}`);
  return found;
}

const args = process.argv.slice(2);
const assertUnpacked = args.includes("--assert-unpacked");
const force = args.includes("--force");
const key = args.find((arg) => !arg.startsWith("--")) || hostKey();

if (assertUnpacked) {
  assertUnpackedTectonic(key);
} else {
  await fetchTectonic(key, { force });
}
