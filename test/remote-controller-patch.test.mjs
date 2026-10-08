import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findPackedFiles, hashBlocks, readAsarHeader, readPackedFile, sha256, verifyIntegrity } from "../lib/asar.mjs";
import { inspectDeviceKeyContract } from "../lib/device-key-contract.mjs";
import { inspectRemoteControllerGate, patchRemoteControllerGate, sha256File } from "../lib/remote-controller-patch.mjs";

const SOURCE = "m=he(`782640499`),we=!m,id:`access-other-devices`,showControlOtherDevices:we,";
const UPDATED_SOURCE = "d=ne(`782640499`),K=!d,id:`access-other-devices`,showControlOtherDevices:K,";
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

for (const fixture of [
  { version: "26.924.22138", source: SOURCE, disabled: "we=!m", enabled: "we=!0" },
  { version: "26.1002.51308", source: UPDATED_SOURCE, disabled: "K=!d", enabled: "K=!0" },
]) {
  test(`patches the reviewed ${fixture.version} binding and verifies every integrity block`, (context) => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "reviewed-controller-patch-"));
    context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
    const asarPath = path.join(temporaryDirectory, "app.asar");
    writeFixture(asarPath, ["webview/assets/remote-connections-settings-deadbeef.js"], fixture.source, true, 32);
    const sizeBefore = fs.statSync(asarPath).size;
    assert.equal(inspectRemoteControllerGate(asarPath).gateText, fixture.disabled);

    const result = patchRemoteControllerGate(asarPath);
    const metadata = readAsarHeader(asarPath);
    const [target] = findPackedFiles(metadata.header, (filePath) => filePath.includes("remote-connections-settings"));
    const packed = readPackedFile(asarPath, metadata, target.entry);
    const integrity = verifyIntegrity(target.entry, packed.buffer);
    assert.equal(result.gate.after, fixture.enabled);
    assert.equal(fs.statSync(asarPath).size, sizeBefore);
    assert.equal(packed.buffer.toString("utf8"), fixture.source.replace(fixture.disabled, fixture.enabled));
    assert.ok(integrity.blocks.length > 1);
    assert.deepEqual(result.after.blocks, integrity.blocks);
    assert.equal(result.after.targetSha256, integrity.hash);
    assert.equal(inspectRemoteControllerGate(asarPath).gateEnabled, true);

    const hashAfter = sha256File(asarPath);
    assert.throws(() => patchRemoteControllerGate(asarPath), /already enabled/);
    assert.equal(sha256File(asarPath), hashAfter);
  });
}

for (const fixture of [
  { name: "unreviewed flag function", source: UPDATED_SOURCE.replace("=ne(", "=other("), error: /feature-flag binding, found 0/ },
  { name: "duplicate flag bindings across reviewed functions", source: `${UPDATED_SOURCE}m=he(\`782640499\`),`, error: /feature-flag binding, found 2/ },
  { name: "missing visibility gate", source: UPDATED_SOURCE.replace("K=!d", "K=d"), error: /controller visibility gate, found 0/ },
  { name: "duplicate visibility gates", source: `${UPDATED_SOURCE}K=!d,`, error: /controller visibility gate, found 2/ },
  { name: "duplicate visibility properties", source: `${UPDATED_SOURCE}showControlOtherDevices:K,`, error: /showControlOtherDevices binding, found 2/ },
]) {
  test(`refuses ${fixture.name} without modifying the archive`, (context) => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rejected-controller-patch-"));
    context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
    const asarPath = path.join(temporaryDirectory, "app.asar");
    writeFixture(asarPath, ["webview/assets/remote-connections-settings-deadbeef.js"], fixture.source);
    const hashBefore = sha256File(asarPath);
    assert.throws(() => patchRemoteControllerGate(asarPath), fixture.error);
    assert.equal(sha256File(asarPath), hashBefore);
  });
}

test("refuses corrupted target integrity without modifying the archive", (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "corrupted-controller-patch-"));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const asarPath = path.join(temporaryDirectory, "app.asar");
  writeFixture(asarPath, ["webview/assets/remote-connections-settings-deadbeef.js"], UPDATED_SOURCE);
  const archive = fs.readFileSync(asarPath);
  archive[archive.length - 1] ^= 1;
  fs.writeFileSync(asarPath, archive);
  const hashBefore = sha256File(asarPath);
  assert.throws(() => patchRemoteControllerGate(asarPath), /Target hash mismatch/);
  assert.equal(sha256File(asarPath), hashBefore);
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

function writeFixture(asarPath, targetPaths, source = SOURCE, padHeader = true, blockSize = 4 * 1024 * 1024) {
  const fileBuffer = Buffer.from(source);
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
