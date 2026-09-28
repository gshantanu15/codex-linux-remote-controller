#!/usr/bin/env node
import fs from "node:fs";
import { inspectRemoteControllerGate, sha256File } from "../lib/remote-controller-patch.mjs";
import { BUILT_NATIVE_ADDON, SOURCE_ASAR, SOURCE_NATIVE_ADDON } from "../lib/paths.mjs";

try {
  const inspection = inspectRemoteControllerGate(SOURCE_ASAR);
  const tpmDevices = ["/dev/tpmrm0", "/dev/tpm0"].filter((device) => fs.existsSync(device));
  const builtProviderHash = fs.existsSync(BUILT_NATIVE_ADDON)
    ? sha256File(BUILT_NATIVE_ADDON)
    : null;
  const installedAddonHash = sha256File(SOURCE_NATIVE_ADDON);
  const report = {
    accessDeviceCount: inspection.accessDeviceCount,
    asarPath: SOURCE_ASAR,
    asarSha256: sha256File(SOURCE_ASAR),
    builtDeviceKeyProvider: fs.existsSync(BUILT_NATIVE_ADDON)
      ? {
          path: BUILT_NATIVE_ADDON,
          sha256: builtProviderHash,
          type: "linux-secret-service-v1",
        }
      : null,
    featureFlagId: "782640499",
    gate: inspection.gateText,
    gateEnabled: inspection.gateEnabled,
    targetPath: inspection.target.path,
    targetSha256: inspection.integrity.hash,
    installedDeviceKeyAddon: {
      path: SOURCE_NATIVE_ADDON,
      sha256: installedAddonHash,
    },
    installedAddonMatchesBuiltProvider: builtProviderHash === installedAddonHash,
    hardwareTpmDevices: tpmDevices,
    hardwareTpmReady: tpmDevices.length > 0,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.builtDeviceKeyProvider) {
    console.error("\nWarning: the replacement provider has not been built yet.");
  }
} catch (error) {
  console.error(`Inspection failed: ${error.message}`);
  process.exitCode = 1;
}
