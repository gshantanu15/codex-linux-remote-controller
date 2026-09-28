import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const addonPath = path.join(projectRoot, "build", "remote-control-device-key.node");
const flowPath = path.join(projectRoot, "test", "native-addon-flow.cjs");

test("matches the Codex device-key addon contract", { timeout: 30_000 }, (context) => {
  for (const command of ["dbus-run-session", "gnome-keyring-daemon"]) {
    const probe = spawnSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" });
    assert.equal(probe.status, 0, `${command} is required for the native integration test`);
  }
  assert.equal(fs.existsSync(addonPath), true, "run npm run build:native before testing");

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-device-key-test-"));
  context.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const home = path.join(temporaryRoot, "home");
  const runtime = path.join(temporaryRoot, "run");
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(runtime, { mode: 0o700 });

  const script = [
    "set -eu",
    'eval "$(printf %s test-password | gnome-keyring-daemon --unlock --components=secrets)"',
    'exec node "$FLOW_PATH"',
  ].join("; ");
  const result = spawnSync("dbus-run-session", ["--", "bash", "-c", script], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ADDON_PATH: addonPath,
      CODEX_HOME: path.join(temporaryRoot, "codex"),
      FLOW_PATH: flowPath,
      HOME: home,
      XDG_RUNTIME_DIR: runtime,
    },
    timeout: 25_000,
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
