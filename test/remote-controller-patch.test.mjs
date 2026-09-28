import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findPackedFiles, hashBlocks, readAsarHeader, readPackedFile, sha256 } from "../lib/asar.mjs";
import { inspectDeviceKeyContract } from "../lib/device-key-contract.mjs";
import { inspectRemoteControllerGate, patchRemoteControllerGate, sha256File } from "../lib/remote-controller-patch.mjs";

const SOURCE = "m=he(`782640499`),we=!m,id:`access-other-devices`,showControlOtherDevices:we,";
const CONTRACT_SOURCE = [
  "remote-control-device-key.node",
  "allow_os_protected_nonextractable",
  "createDeviceKey",
  "deleteDeviceKey",
  "getDeviceKeyPublic",
  "signDeviceKey",
  "signatureDerBase64",
  "signedPayloadBase64",
  "os_protected_nonextractable",
].join(";");

test("enables the controller gate without changing archive length", (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "remote-controller-patch-"));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const asarPath = path.join(temporaryDirectory, "app.asar");
  writeFixture(asarPath, ["webview/assets/remote-connections-settings-deadbeef.js"]);

  const sizeBefore = fs.statSync(asarPath).size;
  const hashBefore = sha256File(asarPath);
  const inspection = inspectRemoteControllerGate(asarPath);
  assert.equal(inspection.gateText, "we=!m");

  const result = patchRemoteControllerGate(asarPath);
  assert.equal(result.before.asarSha256, hashBefore);
  assert.equal(result.gate.after, "we=!0");
  assert.equal(fs.statSync(asarPath).size, sizeBefore);

  const metadata = readAsarHeader(asarPath);
  const [target] = findPackedFiles(metadata.header, (filePath) => filePath.includes("remote-connections-settings"));
  const packed = readPackedFile(asarPath, metadata, target.entry);
  assert.equal(packed.buffer.toString("utf8"), SOURCE.replace("we=!m", "we=!0"));
  assert.equal(target.entry.integrity.hash, sha256(packed.buffer));
  assert.equal(inspectRemoteControllerGate(asarPath).gateEnabled, true);
});

test("patches an ASAR header with no trailing NUL padding", (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "remote-controller-patch-"));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const asarPath = path.join(temporaryDirectory, "app.asar");
  writeFixture(asarPath, ["webview/assets/remote-connections-settings-deadbeef.js"], SOURCE, false);

  const result = patchRemoteControllerGate(asarPath);
  assert.equal(result.gate.after, "we=!0");
});

test("refuses an archive with multiple candidate assets", (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "remote-controller-patch-"));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const asarPath = path.join(temporaryDirectory, "app.asar");
  writeFixture(asarPath, [
    "webview/assets/remote-connections-settings-deadbeef.js",
    "webview/assets/remote-connections-settings-cafebabe.js",
  ]);

  assert.throws(() => inspectRemoteControllerGate(asarPath), /Expected one remote-connections/);
});

test("refuses a non-unique access-other-devices entry", (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "remote-controller-patch-"));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const asarPath = path.join(temporaryDirectory, "app.asar");
  writeFixture(
    asarPath,
    ["webview/assets/remote-connections-settings-deadbeef.js"],
    `${SOURCE}id:\`access-other-devices\``,
  );

  assert.throws(() => inspectRemoteControllerGate(asarPath), /Expected one access-other-devices/);
});

test("recognizes the native device-key client contract", (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "device-key-contract-"));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const asarPath = path.join(temporaryDirectory, "app.asar");
  writeFixture(asarPath, [".vite/build/main-deadbeef.js"], CONTRACT_SOURCE);

  const result = inspectDeviceKeyContract(asarPath);
  assert.equal(result.path, ".vite/build/main-deadbeef.js");
  assert.deepEqual(result.missingMarkers, []);
});

test("refuses a changed native device-key client contract", (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "device-key-contract-"));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const asarPath = path.join(temporaryDirectory, "app.asar");
  writeFixture(
    asarPath,
    [".vite/build/main-deadbeef.js"],
    CONTRACT_SOURCE.replace("signedPayloadBase64", "changedPayloadField"),
  );

  assert.throws(() => inspectDeviceKeyContract(asarPath), /signedPayloadBase64/);
});

function writeFixture(asarPath, targetPaths, source = SOURCE, padHeader = true) {
  const fileBuffer = Buffer.from(source);
  const blockSize = 4 * 1024 * 1024;
  let offset = 0;
  const files = {};
  const payloads = [];

  for (const targetPath of targetPaths) {
    const parts = targetPath.split("/");
    const fileName = parts.pop();
    let directory = files;
    for (const part of parts) {
      directory[part] ??= { files: {} };
      directory = directory[part].files;
    }
    directory[fileName] = {
      integrity: {
        algorithm: "SHA256",
        blockSize,
        blocks: hashBlocks(fileBuffer, blockSize),
        hash: sha256(fileBuffer),
      },
      offset: String(offset),
      size: fileBuffer.length,
    };
    payloads.push(fileBuffer);
    offset += fileBuffer.length;
  }

  const headerJson = Buffer.from(JSON.stringify({ files }));
  const headerSize = padHeader ? Math.ceil((headerJson.length + 1) / 4) * 4 : headerJson.length;
  const header = Buffer.alloc(headerSize);
  headerJson.copy(header);
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(headerSize + 8, 4);
  prefix.writeUInt32LE(headerSize + 4, 8);
  prefix.writeUInt32LE(headerSize, 12);
  fs.writeFileSync(asarPath, Buffer.concat([prefix, header, ...payloads]));
}
