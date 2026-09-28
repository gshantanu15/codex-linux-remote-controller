#!/usr/bin/env node
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { inspectDeviceKeyContract } from "../lib/device-key-contract.mjs";
import { OFFICIAL_STATE_ROOT, listOfficialInstallRecords } from "../lib/official-patch-state.mjs";
import {
  BUILT_NATIVE_ADDON,
  PROJECT_ROOT,
  SOURCE_ASAR,
  SOURCE_NATIVE_ADDON,
  SOURCE_ROOT,
} from "../lib/paths.mjs";
import {
  inspectEnabledRemoteControllerGate,
  inspectRemoteControllerGate,
  patchRemoteControllerGate,
  sha256File,
} from "../lib/remote-controller-patch.mjs";

const currentAsarHash = sha256File(SOURCE_ASAR);
const currentAddonHash = sha256File(SOURCE_NATIVE_ADDON);
for (const { manifest, resultPath } of listOfficialInstallRecords()) {
  if (!fs.existsSync(resultPath)) continue;
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  if (
    result.status === "applied" &&
    currentAsarHash === manifest.patched.asarSha256 &&
    currentAddonHash === manifest.patched.nativeAddonSha256
  ) {
    inspectEnabledRemoteControllerGate(SOURCE_ASAR, manifest.patch.gate.after);
    console.log(`Official Codex ${manifest.packageVersion} is already patched and verified.`);
    process.exit(0);
  }
}

if (!fs.existsSync(BUILT_NATIVE_ADDON)) {
  throw new Error(`Replacement provider not found: ${BUILT_NATIVE_ADDON}`);
}
const addon = createRequire(import.meta.url)(BUILT_NATIVE_ADDON);
const expectedExports = [
  "createDeviceKey",
  "deleteDeviceKey",
  "getDeviceKeyPublic",
  "signDeviceKey",
];
if (JSON.stringify(Object.keys(addon).sort()) !== JSON.stringify(expectedExports)) {
  throw new Error("Replacement provider does not expose the expected addon contract");
}

const appMetadata = fs.readFileSync(path.join(SOURCE_ROOT, "resources", "owl-app.ini"), "utf8");
const versionMatch = appMetadata.match(/^AppVersion=(.+)$/m);
if (!versionMatch) throw new Error("Could not determine the installed Codex version");
const packageVersion = versionMatch[1].trim();
const contract = inspectDeviceKeyContract(SOURCE_ASAR);
const gate = inspectRemoteControllerGate(SOURCE_ASAR);
if (gate.gateText === gate.enabledGateText) {
  throw new Error("Official UI gate is already enabled but is not covered by a known install record");
}

const installId = `${packageVersion}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
const installRoot = path.join(OFFICIAL_STATE_ROOT, installId);
const originalAsar = path.join(installRoot, "original-app.asar");
const originalAddon = path.join(installRoot, "original-remote-control-device-key.node");
const patchedAsar = path.join(installRoot, "patched-app.asar");
const patchedAddon = path.join(installRoot, "patched-remote-control-device-key.node");
const manifestPath = path.join(installRoot, "manifest.json");

fs.mkdirSync(installRoot, { recursive: true, mode: 0o700 });
fs.copyFileSync(SOURCE_ASAR, originalAsar, fs.constants.COPYFILE_FICLONE);
fs.copyFileSync(SOURCE_NATIVE_ADDON, originalAddon, fs.constants.COPYFILE_FICLONE);
fs.copyFileSync(SOURCE_ASAR, patchedAsar, fs.constants.COPYFILE_FICLONE);
fs.copyFileSync(BUILT_NATIVE_ADDON, patchedAddon, fs.constants.COPYFILE_FICLONE);
for (const filePath of [originalAsar, originalAddon, patchedAsar, patchedAddon]) {
  fs.chmodSync(filePath, 0o600);
}

const patch = patchRemoteControllerGate(patchedAsar);
const manifest = {
  createdAt: new Date().toISOString(),
  invoker: { gid: process.getgid(), uid: process.getuid() },
  packageVersion,
  contract,
  original: {
    asarPath: originalAsar,
    asarSha256: sha256File(originalAsar),
    nativeAddonPath: originalAddon,
    nativeAddonSha256: sha256File(originalAddon),
  },
  patch,
  patched: {
    asarPath: patchedAsar,
    asarSha256: sha256File(patchedAsar),
    nativeAddonPath: patchedAddon,
    nativeAddonSha256: sha256File(patchedAddon),
  },
  targets: {
    asarPath: SOURCE_ASAR,
    nativeAddonPath: SOURCE_NATIVE_ADDON,
  },
};
if (manifest.original.asarSha256 !== currentAsarHash) {
  throw new Error("Official ASAR changed while preparing the patch");
}
if (manifest.original.nativeAddonSha256 !== currentAddonHash) {
  throw new Error("Official native addon changed while preparing the patch");
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

const helperPath = path.join(PROJECT_ROOT, "bin", "official-root-helper.mjs");
console.log(`Prepared official patch for Codex ${packageVersion}.`);
console.log(`Backup and manifest: ${installRoot}`);
if (process.argv.includes("--prepare-only")) {
  console.log(`Apply with: pkexec /usr/bin/node ${helperPath} apply ${manifestPath}`);
  process.exit(0);
}
const authorization = spawnSync("pkexec", ["/usr/bin/node", helperPath, "apply", manifestPath], {
  stdio: "inherit",
});
if (authorization.error) throw authorization.error;
if (authorization.status !== 0) {
  throw new Error(`Official patch authorization failed with status ${authorization.status}`);
}
fs.rmSync(patchedAsar, { force: true });
fs.rmSync(patchedAddon, { force: true });
console.log("Official Codex patch applied. Restart Codex before using it.");
