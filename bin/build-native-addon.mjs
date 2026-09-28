#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourcePath = path.join(projectRoot, "native", "remote_control_device_key.cc");
const outputDirectory = path.join(projectRoot, "build");
const outputPath = path.join(outputDirectory, "remote-control-device-key.node");
const localSysroot = path.join(projectRoot, ".deps", "sysroot");
const multiarch = process.arch === "x64" ? "x86_64-linux-gnu" : "aarch64-linux-gnu";

const includeArguments = resolveIncludeArguments();
fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });

const compilerArguments = [
  "-std=c++20",
  "-O2",
  "-D_FORTIFY_SOURCE=3",
  "-fPIC",
  "-fstack-protector-strong",
  "-fvisibility=hidden",
  "-Wall",
  "-Wextra",
  "-Wpedantic",
  "-Werror",
  "-DNAPI_VERSION=8",
  "-I/usr/include/node",
  ...includeArguments,
  "-shared",
  sourcePath,
  "-o",
  outputPath,
  "-Wl,-z,relro",
  "-Wl,-z,now",
  "-Wl,-z,noexecstack",
  "-Wl,--as-needed",
  `-L/lib/${multiarch}`,
  "-l:libsecret-1.so.0",
  "-l:libgio-2.0.so.0",
  "-l:libgobject-2.0.so.0",
  "-l:libglib-2.0.so.0",
  "-lcrypto",
  "-pthread",
];

const result = spawnSync(process.env.CXX || "c++", compilerArguments, {
  cwd: projectRoot,
  encoding: "utf8",
  stdio: "pipe",
});
if (result.status !== 0) {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
fs.chmodSync(outputPath, 0o755);
console.log(outputPath);

function resolveIncludeArguments() {
  const system = spawnSync("pkg-config", ["--cflags", "libsecret-1"], {
    encoding: "utf8",
  });
  if (system.status === 0) return system.stdout.trim().split(/\s+/).filter(Boolean);

  const required = [
    path.join(localSysroot, "usr", "include", "libsecret-1"),
    path.join(localSysroot, "usr", "include", "glib-2.0"),
    path.join(
      localSysroot,
      "usr",
      "lib",
      multiarch,
      "glib-2.0",
      "include",
    ),
  ];
  const missing = required.filter((candidate) => !fs.existsSync(candidate));
  if (missing.length > 0) {
    throw new Error(
      "libsecret development headers are unavailable; install libsecret-1-dev or populate .deps/sysroot",
    );
  }
  return required.map((candidate) => `-I${candidate}`);
}
