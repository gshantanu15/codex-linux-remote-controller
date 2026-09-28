#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { findAppliedRecordMatching } from "../lib/official-patch-state.mjs";
import { inspectEnabledRemoteControllerGate, sha256File } from "../lib/remote-controller-patch.mjs";
import { NATIVE_ADDON_NAME, SOURCE_ASAR, SOURCE_NATIVE_ADDON, STATE_ROOT } from "../lib/paths.mjs";

const currentPath = path.join(STATE_ROOT, "current");
if (!fs.existsSync(currentPath)) throw new Error("No patched test copy is installed");

const versionRoot = fs.realpathSync(currentPath);
const manifest = JSON.parse(fs.readFileSync(path.join(versionRoot, "manifest.json"), "utf8"));
const asarPath = path.join(versionRoot, "app", "resources", "app.asar");
const nativeAddonPath = path.join(versionRoot, "app", "resources", "native", NATIVE_ADDON_NAME);
const sourceHash = sha256File(SOURCE_ASAR);
const patchedHash = sha256File(asarPath);
const sourceNativeHash = sha256File(SOURCE_NATIVE_ADDON);
const nativeAddonHash = sha256File(nativeAddonPath);
const enabled = inspectEnabledRemoteControllerGate(asarPath, manifest.patch.gate.after);
const sourceMatchesInstallBaseline =
  sourceHash === manifest.source.asarSha256 &&
  sourceNativeHash === manifest.source.nativeAddonSha256;
const officialPatchRecord = findAppliedRecordMatching(sourceHash, sourceNativeHash);

if (!sourceMatchesInstallBaseline && !officialPatchRecord) {
  throw new Error("Official Codex files changed without a matching official-patch record");
}
if (patchedHash !== manifest.patch.after.asarSha256) throw new Error("Patched ASAR hash changed");
if (nativeAddonHash !== manifest.deviceKeyProvider.installedSha256) {
  throw new Error("Replacement device-key addon hash changed");
}
if (enabled.targetSha256 !== manifest.patch.after.targetSha256) {
  throw new Error("Patched controller asset hash changed");
}
const addon = createRequire(import.meta.url)(nativeAddonPath);
const exportsFound = Object.keys(addon).sort();
const exportsExpected = [
  "createDeviceKey",
  "deleteDeviceKey",
  "getDeviceKeyPublic",
  "signDeviceKey",
];
if (JSON.stringify(exportsFound) !== JSON.stringify(exportsExpected)) {
  throw new Error(`Unexpected device-key addon exports: ${exportsFound.join(", ")}`);
}

console.log(
  JSON.stringify(
    {
      packageVersion: manifest.packageVersion,
      patchedAsarSha256: patchedHash,
      patchedTargetSha256: enabled.targetSha256,
      deviceKeyProvider: manifest.deviceKeyProvider.type,
      nativeAddonSha256: nativeAddonHash,
      sourceAsarSha256: sourceHash,
      sourceNativeAddonSha256: sourceNativeHash,
      officialSourceState: sourceMatchesInstallBaseline
        ? "original-test-baseline"
        : `known-official-patch:${officialPatchRecord.manifest.packageVersion}`,
      verified: true,
    },
    null,
    2,
  ),
);
