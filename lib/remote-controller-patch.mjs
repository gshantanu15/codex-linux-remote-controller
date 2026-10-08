import crypto from "node:crypto";
import fs from "node:fs";
import { findPackedFiles, hashBlocks, readAsarHeader, readPackedFile, replaceHeaderHashes, sha256, verifyIntegrity, writePatchedAsar } from "./asar.mjs";

export const FEATURE_FLAG_ID = "782640499";
export const TARGET_PATTERN = /^webview\/assets\/remote-connections-settings-[a-f0-9]+\.js$/;

export function inspectRemoteControllerGate(asarPath) {
  const metadata = readAsarHeader(asarPath);
  const targets = findPackedFiles(metadata.header, (filePath) => TARGET_PATTERN.test(filePath));
  if (targets.length !== 1) {
    throw new Error(`Expected one remote-connections settings asset, found ${targets.length}`);
  }

  const target = targets[0];
  const packed = readPackedFile(asarPath, metadata, target.entry);
  const integrity = verifyIntegrity(target.entry, packed.buffer);
  const source = packed.buffer.toString("utf8");

  const flagPattern = new RegExp(`([A-Za-z_$][\\w$]*)=(?:he|ne)\\(\\\`${FEATURE_FLAG_ID}\\\`\\)`, "g");
  const flagMatches = [...source.matchAll(flagPattern)];
  if (flagMatches.length !== 1) {
    throw new Error(`Expected one ${FEATURE_FLAG_ID} feature-flag binding, found ${flagMatches.length}`);
  }
  const flagVariable = flagMatches[0][1];

  const propertyMatches = [...source.matchAll(/showControlOtherDevices:([A-Za-z_$][\w$]*)/g)];
  if (propertyMatches.length !== 1) {
    throw new Error(`Expected one showControlOtherDevices binding, found ${propertyMatches.length}`);
  }
  const visibilityVariable = propertyMatches[0][1];

  const disabledGateText = `${visibilityVariable}=!${flagVariable}`;
  const enabledGateText = `${visibilityVariable}=!0${" ".repeat(flagVariable.length - 1)}`;
  const disabledGateMatches = findOccurrences(source, disabledGateText);
  const enabledGateMatches = findOccurrences(source, enabledGateText);
  const gateMatches = [...disabledGateMatches, ...enabledGateMatches];
  if (gateMatches.length !== 1) {
    throw new Error(`Expected one controller visibility gate, found ${gateMatches.length}`);
  }

  const accessDeviceCount = countOccurrences(source, "id:`access-other-devices`");
  if (accessDeviceCount !== 1) {
    throw new Error(`Expected one access-other-devices entry, found ${accessDeviceCount}`);
  }

  const gateText = source.slice(gateMatches[0], gateMatches[0] + disabledGateText.length);
  if (enabledGateText.length !== gateText.length) {
    throw new Error("Controller gate replacement would change packed-file length");
  }

  return {
    accessDeviceCount,
    asarPath,
    fileOffset: packed.offset,
    flagVariable,
    gateByteOffset: Buffer.byteLength(source.slice(0, gateMatches[0]), "utf8"),
    gateEnabled: gateText === enabledGateText,
    gateText,
    enabledGateText,
    integrity,
    metadata,
    sourceBuffer: packed.buffer,
    target,
    visibilityVariable,
  };
}

export function patchRemoteControllerGate(asarPath) {
  const originalAsarSha256 = sha256File(asarPath);
  const inspection = inspectRemoteControllerGate(asarPath);
  if (inspection.gateText === inspection.enabledGateText) {
    throw new Error("Controller gate is already enabled");
  }

  const patchedFile = Buffer.from(inspection.sourceBuffer);
  patchedFile.write(
    inspection.enabledGateText,
    inspection.gateByteOffset,
    Buffer.byteLength(inspection.enabledGateText),
    "utf8",
  );

  if (patchedFile.length !== inspection.sourceBuffer.length) {
    throw new Error("Patched packed-file length changed");
  }

  const newIntegrity = {
    blockSize: inspection.integrity.blockSize,
    blocks: hashBlocks(patchedFile, inspection.integrity.blockSize),
    hash: sha256(patchedFile),
  };

  const oldHashes = [inspection.integrity.hash, ...inspection.integrity.blocks];
  const newHashes = [newIntegrity.hash, ...newIntegrity.blocks];
  const grouped = new Map();
  for (let index = 0; index < oldHashes.length; index += 1) {
    const key = `${oldHashes[index]}\0${newHashes[index]}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  const replacements = [...grouped.entries()].map(([key, count]) => {
    const [oldHash, newHash] = key.split("\0");
    return [oldHash, newHash, count];
  });

  const patchedHeader = replaceHeaderHashes(inspection.metadata.headerBuffer, replacements);
  const nulIndex = patchedHeader.indexOf(0);
  const jsonLength = nulIndex === -1 ? patchedHeader.length : nulIndex;
  JSON.parse(patchedHeader.subarray(0, jsonLength).toString("utf8"));
  writePatchedAsar(
    asarPath,
    inspection.metadata,
    inspection.fileOffset,
    patchedFile,
    patchedHeader,
  );

  const verification = inspectEnabledRemoteControllerGate(asarPath, inspection.enabledGateText);
  return {
    after: {
      asarSha256: sha256File(asarPath),
      blocks: newIntegrity.blocks,
      targetSha256: verification.targetSha256,
    },
    before: {
      asarSha256: originalAsarSha256,
      blocks: inspection.integrity.blocks,
      targetSha256: inspection.integrity.hash,
    },
    featureFlagId: FEATURE_FLAG_ID,
    gate: { after: inspection.enabledGateText, before: inspection.gateText },
    targetPath: inspection.target.path,
  };
}

export function inspectEnabledRemoteControllerGate(asarPath, expectedGateText) {
  const metadata = readAsarHeader(asarPath);
  const targets = findPackedFiles(metadata.header, (filePath) => TARGET_PATTERN.test(filePath));
  if (targets.length !== 1) throw new Error(`Expected one target after patch, found ${targets.length}`);
  const packed = readPackedFile(asarPath, metadata, targets[0].entry);
  verifyIntegrity(targets[0].entry, packed.buffer);
  const source = packed.buffer.toString("utf8");
  if (countOccurrences(source, expectedGateText) !== 1) {
    throw new Error("Enabled controller gate did not verify uniquely");
  }
  return { targetSha256: sha256(packed.buffer) };
}

export function sha256File(filePath) {
  const descriptor = fs.openSync(filePath, "r");
  const digest = crypto.createHash("sha256");
  const buffer = Buffer.alloc(8 * 1024 * 1024);
  try {
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      digest.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return digest.digest("hex");
}

function countOccurrences(source, needle) {
  return findOccurrences(source, needle).length;
}

function findOccurrences(source, needle) {
  const positions = [];
  let from = 0;
  while (from < source.length) {
    const index = source.indexOf(needle, from);
    if (index === -1) break;
    positions.push(index);
    from = index + needle.length;
  }
  return positions;
}
