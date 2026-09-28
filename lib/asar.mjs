import crypto from "node:crypto";
import fs from "node:fs";

const HEADER_PREFIX_SIZE = 16;

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function readAsarHeader(asarPath) {
  const descriptor = fs.openSync(asarPath, "r");
  try {
    const prefix = Buffer.alloc(HEADER_PREFIX_SIZE);
    readExactly(descriptor, prefix, 0);

    const headerSize = prefix.readUInt32LE(12);
    if (prefix.readUInt32LE(0) !== 4 || headerSize === 0) {
      throw new Error(`Unsupported ASAR header in ${asarPath}`);
    }

    const headerBuffer = Buffer.alloc(headerSize);
    readExactly(descriptor, headerBuffer, HEADER_PREFIX_SIZE);
    const nulIndex = headerBuffer.indexOf(0);
    const jsonLength = nulIndex === -1 ? headerBuffer.length : nulIndex;
    const headerText = headerBuffer.subarray(0, jsonLength).toString("utf8");
    const header = JSON.parse(headerText);

    return {
      dataOffset: HEADER_PREFIX_SIZE + headerSize,
      header,
      headerBuffer,
      headerSize,
      headerText,
      prefix,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function findPackedFiles(header, matcher) {
  const matches = [];

  function visit(files, parentPath) {
    for (const [name, entry] of Object.entries(files ?? {})) {
      const filePath = parentPath ? `${parentPath}/${name}` : name;
      if (entry.files) {
        visit(entry.files, filePath);
      } else if (!entry.unpacked && matcher(filePath, entry)) {
        matches.push({ entry, path: filePath });
      }
    }
  }

  visit(header.files, "");
  return matches;
}

export function readPackedFile(asarPath, metadata, entry) {
  const size = Number(entry.size);
  const offset = metadata.dataOffset + Number(entry.offset);
  if (!Number.isSafeInteger(size) || !Number.isSafeInteger(offset)) {
    throw new Error("Invalid packed-file size or offset");
  }

  const descriptor = fs.openSync(asarPath, "r");
  try {
    const buffer = Buffer.alloc(size);
    readExactly(descriptor, buffer, offset);
    return { buffer, offset };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function verifyIntegrity(entry, buffer) {
  const integrity = entry.integrity;
  if (!integrity || integrity.algorithm !== "SHA256") {
    throw new Error("Target file does not use SHA256 ASAR integrity metadata");
  }

  const actualHash = sha256(buffer);
  if (actualHash !== integrity.hash) {
    throw new Error(`Target hash mismatch: expected ${integrity.hash}, got ${actualHash}`);
  }

  const blockSize = Number(integrity.blockSize);
  if (!Number.isSafeInteger(blockSize) || blockSize <= 0) {
    throw new Error("Invalid ASAR integrity block size");
  }

  const actualBlocks = hashBlocks(buffer, blockSize);
  if (actualBlocks.length !== integrity.blocks.length) {
    throw new Error("ASAR integrity block count mismatch");
  }
  for (let index = 0; index < actualBlocks.length; index += 1) {
    if (actualBlocks[index] !== integrity.blocks[index]) {
      throw new Error(`ASAR integrity block ${index} mismatch`);
    }
  }

  return { blockSize, blocks: actualBlocks, hash: actualHash };
}

export function hashBlocks(buffer, blockSize) {
  const blocks = [];
  for (let offset = 0; offset < buffer.length; offset += blockSize) {
    blocks.push(sha256(buffer.subarray(offset, Math.min(offset + blockSize, buffer.length))));
  }
  return blocks;
}

export function replaceHeaderHashes(headerBuffer, replacements) {
  const updated = Buffer.from(headerBuffer);
  for (const [oldHash, newHash, expectedCount] of replacements) {
    if (oldHash.length !== newHash.length) {
      throw new Error("ASAR hash replacement must preserve length");
    }

    const oldBytes = Buffer.from(oldHash);
    const newBytes = Buffer.from(newHash);
    const positions = [];
    let from = 0;
    while (from < updated.length) {
      const position = updated.indexOf(oldBytes, from);
      if (position === -1) break;
      positions.push(position);
      from = position + oldBytes.length;
    }

    if (positions.length !== expectedCount) {
      throw new Error(
        `Expected ${expectedCount} header occurrence(s) of ${oldHash}, found ${positions.length}`,
      );
    }
    for (const position of positions) newBytes.copy(updated, position);
  }
  return updated;
}

export function writePatchedAsar(asarPath, metadata, fileOffset, patchedFile, patchedHeader) {
  if (patchedHeader.length !== metadata.headerBuffer.length) {
    throw new Error("Patched ASAR header changed size");
  }

  const descriptor = fs.openSync(asarPath, "r+");
  try {
    fs.writeSync(descriptor, patchedHeader, 0, patchedHeader.length, HEADER_PREFIX_SIZE);
    fs.writeSync(descriptor, patchedFile, 0, patchedFile.length, fileOffset);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function readExactly(descriptor, buffer, position) {
  let read = 0;
  while (read < buffer.length) {
    const count = fs.readSync(descriptor, buffer, read, buffer.length - read, position + read);
    if (count === 0) throw new Error("Unexpected end of file");
    read += count;
  }
}
