import { findPackedFiles, readAsarHeader, readPackedFile, sha256 } from "./asar.mjs";

const MAIN_BUNDLE_PATTERN = /^\.vite\/build\/main-[A-Za-z0-9_-]+\.js$/;
const REQUIRED_MARKERS = [
  "remote-control-device-key.node",
  "allow_os_protected_nonextractable",
  "createDeviceKey",
  "deleteDeviceKey",
  "getDeviceKeyPublic",
  "signDeviceKey",
  "signatureDerBase64",
  "signedPayloadBase64",
  "os_protected_nonextractable",
];

export function inspectDeviceKeyContract(asarPath) {
  const metadata = readAsarHeader(asarPath);
  const bundles = findPackedFiles(metadata.header, (filePath) => MAIN_BUNDLE_PATTERN.test(filePath));
  const matching = [];

  for (const bundle of bundles) {
    const packed = readPackedFile(asarPath, metadata, bundle.entry);
    const source = packed.buffer.toString("utf8");
    if (!source.includes("remote-control-device-key.node")) continue;
    const missingMarkers = REQUIRED_MARKERS.filter((marker) => !source.includes(marker));
    matching.push({
      missingMarkers,
      path: bundle.path,
      sha256: sha256(packed.buffer),
    });
  }

  if (matching.length !== 1) {
    throw new Error(`Expected one main bundle with the device-key client, found ${matching.length}`);
  }
  if (matching[0].missingMarkers.length > 0) {
    throw new Error(
      `Device-key client contract changed; missing: ${matching[0].missingMarkers.join(", ")}`,
    );
  }
  return matching[0];
}
