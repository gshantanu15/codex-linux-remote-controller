#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { patchRemoteControllerGate, sha256File } from "../lib/remote-controller-patch.mjs";
import {
  BUILT_NATIVE_ADDON,
  NATIVE_ADDON_NAME,
  SOURCE_ASAR,
  SOURCE_NATIVE_ADDON,
  SOURCE_ROOT,
  STATE_ROOT,
  versionPaths,
} from "../lib/paths.mjs";

const replaceExisting = process.argv.includes("--replace");
const appMetadata = fs.readFileSync(path.join(SOURCE_ROOT, "resources", "owl-app.ini"), "utf8");
const versionMatch = appMetadata.match(/^AppVersion=(.+)$/m);
if (!versionMatch) throw new Error("Could not determine the installed Codex version");
const version = versionMatch[1].trim();
const paths = versionPaths(version);

if (!fs.existsSync(SOURCE_ASAR)) throw new Error(`Official ASAR not found: ${SOURCE_ASAR}`);
if (!fs.existsSync(SOURCE_NATIVE_ADDON)) {
  throw new Error(`Official device-key addon not found: ${SOURCE_NATIVE_ADDON}`);
}
if (!fs.existsSync(BUILT_NATIVE_ADDON)) {
  throw new Error(`Replacement device-key addon not found: ${BUILT_NATIVE_ADDON}`);
}
if (fs.existsSync(paths.versionRoot) && !replaceExisting) {
  throw new Error(`${paths.versionRoot} already exists; use --replace to rebuild it`);
}

const sourceHashBefore = sha256File(SOURCE_ASAR);
const stageRoot = path.join(
  STATE_ROOT,
  "versions",
  `.installing-${version}-${process.pid}-${crypto.randomBytes(4).toString("hex")}`,
);
const stageApp = path.join(stageRoot, "app");
const stageAsar = path.join(stageApp, "resources", "app.asar");
const stageNativeAddon = path.join(stageApp, "resources", "native", NATIVE_ADDON_NAME);

fs.mkdirSync(path.dirname(stageRoot), { recursive: true, mode: 0o700 });
try {
  console.log(`Copying ${SOURCE_ROOT} to ${stageApp} ...`);
  fs.cpSync(SOURCE_ROOT, stageApp, {
    dereference: false,
    mode: fs.constants.COPYFILE_FICLONE,
    preserveTimestamps: true,
    recursive: true,
    verbatimSymlinks: true,
  });

  const copiedHash = sha256File(stageAsar);
  if (copiedHash !== sourceHashBefore) {
    throw new Error(`Copied ASAR hash mismatch: expected ${sourceHashBefore}, got ${copiedHash}`);
  }
  const sourceNativeHash = sha256File(SOURCE_NATIVE_ADDON);
  const copiedNativeHash = sha256File(stageNativeAddon);
  if (copiedNativeHash !== sourceNativeHash) {
    throw new Error(
      `Copied device-key addon hash mismatch: expected ${sourceNativeHash}, got ${copiedNativeHash}`,
    );
  }

  fs.chmodSync(stageAsar, 0o644);
  const patch = patchRemoteControllerGate(stageAsar);
  if (patch.before.asarSha256 !== sourceHashBefore) {
    throw new Error("Patch input hash differs from the verified source hash");
  }

  fs.copyFileSync(BUILT_NATIVE_ADDON, stageNativeAddon);
  fs.chmodSync(stageNativeAddon, 0o755);
  const replacementNativeHash = sha256File(BUILT_NATIVE_ADDON);
  const installedNativeHash = sha256File(stageNativeAddon);
  if (installedNativeHash !== replacementNativeHash) {
    throw new Error("Installed device-key addon differs from the verified build output");
  }

  const sourceHashAfter = sha256File(SOURCE_ASAR);
  if (sourceHashAfter !== sourceHashBefore) {
    throw new Error("Official ASAR changed during installation; refusing the staged copy");
  }
  if (sha256File(SOURCE_NATIVE_ADDON) !== sourceNativeHash) {
    throw new Error("Official device-key addon changed during installation; refusing the staged copy");
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    packageVersion: version,
    patch,
    source: {
      asarPath: SOURCE_ASAR,
      asarSha256: sourceHashBefore,
      nativeAddonPath: SOURCE_NATIVE_ADDON,
      nativeAddonSha256: sourceNativeHash,
      root: SOURCE_ROOT,
    },
    status: "patched-test-copy",
    deviceKeyProvider: {
      algorithm: "ecdsa_p256_sha256",
      builtPath: BUILT_NATIVE_ADDON,
      installedSha256: installedNativeHash,
      originalSha256: sourceNativeHash,
      protectionClass: "os_protected_nonextractable",
      type: "linux-secret-service-v1",
    },
  };
  fs.writeFileSync(path.join(stageRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.mkdirSync(path.join(stageRoot, "logs"), { recursive: true, mode: 0o700 });

  if (fs.existsSync(paths.versionRoot)) fs.rmSync(paths.versionRoot, { recursive: true, force: true });
  fs.renameSync(stageRoot, paths.versionRoot);
  updateCurrentSymlink(paths.versionRoot);

  console.log(`Installed patched test copy: ${paths.versionRoot}`);
  console.log(`Original ASAR remains:       ${sourceHashAfter}`);
  console.log(`Patched ASAR:                ${patch.after.asarSha256}`);
  console.log(`Device-key provider:         ${installedNativeHash}`);
} catch (error) {
  fs.rmSync(stageRoot, { recursive: true, force: true });
  throw error;
}

function updateCurrentSymlink(versionRoot) {
  fs.mkdirSync(STATE_ROOT, { recursive: true, mode: 0o700 });
  const currentPath = path.join(STATE_ROOT, "current");
  const temporaryPath = `${currentPath}.tmp-${process.pid}`;
  fs.rmSync(temporaryPath, { force: true });
  fs.symlinkSync(versionRoot, temporaryPath);
  fs.renameSync(temporaryPath, currentPath);
}
