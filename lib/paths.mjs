import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SOURCE_ROOT = "/usr/lib/chatgpt";
export const SOURCE_ASAR = path.join(SOURCE_ROOT, "resources", "app.asar");
export const NATIVE_ADDON_NAME = "remote-control-device-key.node";
export const SOURCE_NATIVE_ADDON = path.join(SOURCE_ROOT, "resources", "native", NATIVE_ADDON_NAME);
export const BUILT_NATIVE_ADDON = path.join(PROJECT_ROOT, "build", NATIVE_ADDON_NAME);
export const STATE_ROOT = path.join(os.homedir(), ".local", "share", "codex-linux-remote-controller-test");

export function versionPaths(version) {
  const versionRoot = path.join(STATE_ROOT, "versions", version);
  return {
    appRoot: path.join(versionRoot, "app"),
    asarPath: path.join(versionRoot, "app", "resources", "app.asar"),
    logPath: path.join(versionRoot, "logs", "launcher.log"),
    manifestPath: path.join(versionRoot, "manifest.json"),
    profileRoot: path.join(STATE_ROOT, "profiles", version),
    versionRoot,
  };
}
