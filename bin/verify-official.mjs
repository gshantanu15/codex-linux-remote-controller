#!/usr/bin/env node
import { createRequire } from "node:module";
import { inspectDeviceKeyContract } from "../lib/device-key-contract.mjs";
import { findLatestAppliedRecord } from "../lib/official-patch-state.mjs";
import { SOURCE_ASAR, SOURCE_NATIVE_ADDON } from "../lib/paths.mjs";
import {
  inspectEnabledRemoteControllerGate,
  sha256File,
} from "../lib/remote-controller-patch.mjs";

const record = findLatestAppliedRecord();
if (!record) throw new Error("No applied official patch record was found");
const { manifest } = record;
const currentAsarHash = sha256File(SOURCE_ASAR);
const currentAddonHash = sha256File(SOURCE_NATIVE_ADDON);

if (
  currentAsarHash !== manifest.patched.asarSha256 ||
  currentAddonHash !== manifest.patched.nativeAddonSha256
) {
  console.log(
    JSON.stringify(
      {
        packageVersion: manifest.packageVersion,
        patchCurrent: false,
        reason: "The official package changed or the patch was restored; rerun npm run official:install",
      },
      null,
      2,
    ),
  );
  process.exitCode = 2;
} else {
  const gate = inspectEnabledRemoteControllerGate(SOURCE_ASAR, manifest.patch.gate.after);
  const contract = inspectDeviceKeyContract(SOURCE_ASAR);
  const addon = createRequire(import.meta.url)(SOURCE_NATIVE_ADDON);
  console.log(
    JSON.stringify(
      {
        addonExports: Object.keys(addon).sort(),
        contractBundle: contract.path,
        packageVersion: manifest.packageVersion,
        patchCurrent: true,
        patchedAsarSha256: currentAsarHash,
        patchedNativeAddonSha256: currentAddonHash,
        patchedTargetSha256: gate.targetSha256,
      },
      null,
      2,
    ),
  );
}
