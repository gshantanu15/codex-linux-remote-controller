#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { inspectEnabledRemoteControllerGate, sha256File } from "../lib/remote-controller-patch.mjs";
import { findAppliedRecordMatching } from "../lib/official-patch-state.mjs";
import { NATIVE_ADDON_NAME, SOURCE_ASAR, SOURCE_NATIVE_ADDON, STATE_ROOT } from "../lib/paths.mjs";

const currentPath = path.join(STATE_ROOT, "current");
if (!fs.existsSync(currentPath)) throw new Error("No patched test copy is installed");

const useExistingProfile = process.argv.includes("--use-existing-profile");
const forwardedArguments = process.argv.slice(2).filter((argument) => argument !== "--use-existing-profile");
const versionRoot = fs.realpathSync(currentPath);
const manifest = JSON.parse(fs.readFileSync(path.join(versionRoot, "manifest.json"), "utf8"));
const appRoot = path.join(versionRoot, "app");
const executable = path.join(appRoot, "ChatGPT");
const profileRoot = path.join(STATE_ROOT, "profiles", manifest.packageVersion);
const xdgConfigHome = path.join(profileRoot, "xdg-config");
const userDataPath = path.join(xdgConfigHome, "Codex");
const codexHome = path.join(profileRoot, "codex-home");
const sqliteHome = path.join(profileRoot, "sqlite-home");
const logDirectory = path.join(versionRoot, "logs");
const logPath = path.join(logDirectory, "launcher.log");
const asarPath = path.join(appRoot, "resources", "app.asar");
const nativeAddonPath = path.join(appRoot, "resources", "native", NATIVE_ADDON_NAME);

if (!fs.existsSync(executable)) throw new Error(`Test executable not found: ${executable}`);
refuseConcurrentApps(executable);
verifyInstallation();
for (const directory of [xdgConfigHome, userDataPath, codexHome, sqliteHome, logDirectory]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

const log = fs.openSync(logPath, "a", 0o600);
const appArguments = useExistingProfile
  ? ["codex://settings/connections/devices", ...forwardedArguments]
  : [`--user-data-dir=${userDataPath}`, "codex://settings/connections/devices", ...forwardedArguments];
const appEnvironment = useExistingProfile
  ? process.env
  : {
      ...process.env,
      CODEX_ELECTRON_USER_DATA_PATH: userDataPath,
      CODEX_HOME: codexHome,
      CODEX_SQLITE_HOME: sqliteHome,
      XDG_CONFIG_HOME: xdgConfigHome,
    };
const child = spawn(
  executable,
  appArguments,
  {
    cwd: appRoot,
    detached: true,
    env: appEnvironment,
    stdio: ["ignore", log, log],
  },
);

const earlyExit = await new Promise((resolve) => {
  let settled = false;
  child.once("exit", (code, signal) => {
    if (!settled) {
      settled = true;
      resolve({ code, signal });
    }
  });
  setTimeout(() => {
    if (!settled) {
      settled = true;
      resolve(null);
    }
  }, 2500);
});
fs.closeSync(log);

if (earlyExit) {
  throw new Error(
    `Test app exited during startup (code=${earlyExit.code}, signal=${earlyExit.signal}); inspect ${logPath}`,
  );
}

child.unref();
console.log(`Launched ${useExistingProfile ? "existing-profile" : "isolated"} Codex test copy (PID ${child.pid}).`);
console.log(`Profile: ${useExistingProfile ? "existing ~/.config/Codex" : profileRoot}`);
console.log(`Log:     ${logPath}`);
if (!process.env.DBUS_SESSION_BUS_ADDRESS) {
  console.warn("Warning: no D-Bus session address is set; GNOME Keyring access may fail.");
}

function verifyInstallation() {
  const sourceHash = sha256File(SOURCE_ASAR);
  const sourceNativeHash = sha256File(SOURCE_NATIVE_ADDON);
  const sourceMatchesInstallBaseline =
    sourceHash === manifest.source.asarSha256 &&
    sourceNativeHash === manifest.source.nativeAddonSha256;
  if (!sourceMatchesInstallBaseline && !findAppliedRecordMatching(sourceHash, sourceNativeHash)) {
    throw new Error(
      "Official Codex changed without a matching official-patch record; verify the update before launching",
    );
  }
  const patchedHash = sha256File(asarPath);
  if (patchedHash !== manifest.patch.after.asarSha256) {
    throw new Error("Patched ASAR hash does not match its manifest");
  }
  const verification = inspectEnabledRemoteControllerGate(asarPath, manifest.patch.gate.after);
  if (verification.targetSha256 !== manifest.patch.after.targetSha256) {
    throw new Error("Patched controller asset hash does not match its manifest");
  }
  if (sha256File(nativeAddonPath) !== manifest.deviceKeyProvider.installedSha256) {
    throw new Error("Replacement device-key addon does not match its manifest");
  }
}

function refuseConcurrentApps(testExecutable) {
  const conflicts = findProcesses((command) =>
    command.includes("/usr/lib/chatgpt/ChatGPT") || command.includes(testExecutable),
  );
  if (conflicts.length > 0) {
    throw new Error(`Close all official and test Codex windows before launching:\n${conflicts.join("\n")}`);
  }
}

function findProcesses(predicate) {
  const processes = [];
  for (const entry of fs.readdirSync("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name) || Number(entry.name) === process.pid) continue;
    try {
      const command = fs
        .readFileSync(path.join("/proc", entry.name, "cmdline"))
        .toString("utf8")
        .replaceAll("\0", " ")
        .trim();
      if (command && predicate(command)) processes.push(`${entry.name} ${command}`);
    } catch {
    }
  }
  return processes;
}
