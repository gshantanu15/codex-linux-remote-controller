#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  inspectEnabledRemoteControllerGate,
  sha256File,
} from "../lib/remote-controller-patch.mjs";

if (process.getuid() !== 0) throw new Error("This helper must run as root");
const [operation, manifestArgument] = process.argv.slice(2);
if (!["apply", "restore"].includes(operation) || !manifestArgument) {
  throw new Error("Usage: official-root-helper.mjs <apply|restore> <manifest.json>");
}
const invokingUid = readPkexecUid();
const manifestPath = path.resolve(manifestArgument);
const manifest = readManifest(manifestPath, invokingUid);
const resultPath = path.join(path.dirname(manifestPath), "result.json");

refuseRunningOfficialApp();
validateManifestPaths(manifest);
validateManifestFiles(manifest);

if (operation === "apply") applyPatch();
else restorePatch();

function applyPatch() {
  verifyHash(manifest.targets.asarPath, manifest.original.asarSha256, "official ASAR");
  verifyHash(
    manifest.targets.nativeAddonPath,
    manifest.original.nativeAddonSha256,
    "official native addon",
  );
  verifyHash(manifest.patched.asarPath, manifest.patched.asarSha256, "staged ASAR");
  verifyHash(
    manifest.patched.nativeAddonPath,
    manifest.patched.nativeAddonSha256,
    "staged native addon",
  );

  try {
    atomicReplace(
      manifest.patched.asarPath,
      manifest.targets.asarPath,
      manifest.patched.asarSha256,
    );
    atomicReplace(
      manifest.patched.nativeAddonPath,
      manifest.targets.nativeAddonPath,
      manifest.patched.nativeAddonSha256,
    );
    verifyPatchedInstall();
  } catch (error) {
    try {
      atomicReplace(
        manifest.original.asarPath,
        manifest.targets.asarPath,
        manifest.original.asarSha256,
      );
      atomicReplace(
        manifest.original.nativeAddonPath,
        manifest.targets.nativeAddonPath,
        manifest.original.nativeAddonSha256,
      );
    } catch (rollbackError) {
      throw new Error(`${error.message}; automatic rollback also failed: ${rollbackError.message}`);
    }
    throw error;
  }
  writeResult("applied");
}

function restorePatch() {
  verifyHash(manifest.targets.asarPath, manifest.patched.asarSha256, "patched ASAR");
  verifyHash(
    manifest.targets.nativeAddonPath,
    manifest.patched.nativeAddonSha256,
    "patched native addon",
  );
  verifyHash(manifest.original.asarPath, manifest.original.asarSha256, "backup ASAR");
  verifyHash(
    manifest.original.nativeAddonPath,
    manifest.original.nativeAddonSha256,
    "backup native addon",
  );
  atomicReplace(
    manifest.original.asarPath,
    manifest.targets.asarPath,
    manifest.original.asarSha256,
  );
  atomicReplace(
    manifest.original.nativeAddonPath,
    manifest.targets.nativeAddonPath,
    manifest.original.nativeAddonSha256,
  );
  verifyHash(manifest.targets.asarPath, manifest.original.asarSha256, "restored ASAR");
  verifyHash(
    manifest.targets.nativeAddonPath,
    manifest.original.nativeAddonSha256,
    "restored native addon",
  );
  writeResult("restored");
}

function verifyPatchedInstall() {
  verifyHash(manifest.targets.asarPath, manifest.patched.asarSha256, "installed ASAR");
  verifyHash(
    manifest.targets.nativeAddonPath,
    manifest.patched.nativeAddonSha256,
    "installed native addon",
  );
  inspectEnabledRemoteControllerGate(manifest.targets.asarPath, manifest.patch.gate.after);
}

function atomicReplace(sourcePath, targetPath, expectedHash) {
  const targetInformation = fs.statSync(targetPath);
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.codex-remote-patch-${process.pid}`,
  );
  try {
    fs.copyFileSync(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    verifyHash(temporaryPath, expectedHash, "temporary replacement");
    fs.chmodSync(temporaryPath, targetInformation.mode & 0o7777);
    fs.chownSync(temporaryPath, targetInformation.uid, targetInformation.gid);
    const descriptor = fs.openSync(temporaryPath, "r");
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporaryPath, targetPath);
    const directory = fs.openSync(path.dirname(targetPath), "r");
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
    }
    throw error;
  }
}

function verifyHash(filePath, expected, label) {
  const actual = sha256File(filePath);
  if (actual !== expected) throw new Error(`${label} hash mismatch: expected ${expected}, got ${actual}`);
}

function validateManifestPaths(value) {
  if (value.invoker.uid !== invokingUid) {
    throw new Error("Manifest invoking user does not match PKEXEC_UID");
  }
  if (!Number.isSafeInteger(value.invoker.gid) || value.invoker.gid < 0) {
    throw new Error("Manifest contains an invalid invoking group");
  }
  if (value.targets.asarPath !== "/usr/lib/chatgpt/resources/app.asar") {
    throw new Error("Refusing unexpected official ASAR target");
  }
  if (
    value.targets.nativeAddonPath !==
    "/usr/lib/chatgpt/resources/native/remote-control-device-key.node"
  ) {
    throw new Error("Refusing unexpected official native-addon target");
  }
  for (const candidate of [
    value.original.asarPath,
    value.original.nativeAddonPath,
    value.patched.asarPath,
    value.patched.nativeAddonPath,
  ]) {
    if (path.dirname(candidate) !== path.dirname(manifestPath)) {
      throw new Error("Refusing a staged file outside the manifest directory");
    }
  }
}

function validateManifestFiles(value) {
  validatePrivateDirectory(path.dirname(manifestPath), "install record directory");
  validatePrivateFile(manifestPath, "manifest");
  validatePrivateFile(value.original.asarPath, "backup ASAR");
  validatePrivateFile(value.original.nativeAddonPath, "backup native addon");
  if (operation === "apply") {
    validatePrivateFile(value.patched.asarPath, "staged ASAR");
    validatePrivateFile(value.patched.nativeAddonPath, "staged native addon");
  }
}

function validatePrivateDirectory(directoryPath, label) {
  const information = fs.lstatSync(directoryPath);
  if (
    !information.isDirectory() ||
    information.isSymbolicLink() ||
    information.uid !== invokingUid ||
    (information.mode & 0o077) !== 0
  ) {
    throw new Error(label + " is unsafe");
  }
}

function validatePrivateFile(filePath, label) {
  const information = fs.lstatSync(filePath);
  if (
    !information.isFile() ||
    information.isSymbolicLink() ||
    information.uid !== invokingUid ||
    (information.mode & 0o077) !== 0
  ) {
    throw new Error(`Refusing unsafe ${label}`);
  }
}

function readPkexecUid() {
  const value = Number(process.env.PKEXEC_UID);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("This helper must be invoked by pkexec with a valid PKEXEC_UID");
  }
  return value;
}

function readManifest(filePath, expectedUid) {
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const information = fs.fstatSync(descriptor);
    if (
      !information.isFile() ||
      information.uid !== expectedUid ||
      (information.mode & 0o077) !== 0
    ) {
      throw new Error("Refusing unsafe manifest");
    }
    return JSON.parse(fs.readFileSync(descriptor, "utf8"));
  } finally {
    fs.closeSync(descriptor);
  }
}

function refuseRunningOfficialApp() {
  const conflicts = [];
  for (const entry of fs.readdirSync("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    try {
      const command = fs
        .readFileSync(path.join("/proc", entry.name, "cmdline"))
        .toString("utf8")
        .replaceAll("\0", " ")
        .trim();
      if (command.includes("/usr/lib/chatgpt/ChatGPT")) conflicts.push(`${entry.name} ${command}`);
    } catch {
    }
  }
  if (conflicts.length > 0) {
    throw new Error(`Close the official Codex app before continuing:\n${conflicts.join("\n")}`);
  }
}

function writeResult(status) {
  const temporaryPath = `${resultPath}.tmp-${process.pid}`;
  try {
    const descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    try {
      fs.writeFileSync(
        descriptor,
        `${JSON.stringify({ completedAt: new Date().toISOString(), status }, null, 2)}\n`,
      );
      fs.fsyncSync(descriptor);
      fs.fchownSync(descriptor, invokingUid, manifest.invoker.gid);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporaryPath, resultPath);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
    }
    throw error;
  }
  const directory = fs.openSync(path.dirname(resultPath), "r");
  try {
    fs.fsyncSync(directory);
  } finally {
    fs.closeSync(directory);
  }
}
