#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { STATE_ROOT } from "../lib/paths.mjs";

const removeProfile = process.argv.includes("--profile");
const currentPath = path.join(STATE_ROOT, "current");
if (!fs.existsSync(currentPath)) {
  console.log("No patched test copy is installed.");
  process.exit(0);
}

const versionRoot = fs.realpathSync(currentPath);
const manifest = JSON.parse(fs.readFileSync(path.join(versionRoot, "manifest.json"), "utf8"));
const executable = path.join(versionRoot, "app", "ChatGPT");
const conflicts = [];
for (const entry of fs.readdirSync("/proc", { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^\d+$/.test(entry.name) || Number(entry.name) === process.pid) continue;
  try {
    const command = fs
      .readFileSync(path.join("/proc", entry.name, "cmdline"))
      .toString("utf8")
      .replaceAll("\0", " ")
      .trim();
    if (command.includes(executable)) conflicts.push(`${entry.name} ${command}`);
  } catch {
  }
}
if (conflicts.length > 0) {
  throw new Error(`Close the patched test app before removal:\n${conflicts.join("\n")}`);
}

fs.rmSync(currentPath, { force: true });
fs.rmSync(versionRoot, { recursive: true, force: true });
console.log(`Removed patched test copy ${manifest.packageVersion}.`);

if (removeProfile) {
  const profileRoot = path.join(STATE_ROOT, "profiles", manifest.packageVersion);
  fs.rmSync(profileRoot, { recursive: true, force: true });
  console.log(`Removed isolated profile ${profileRoot}.`);
} else {
  console.log("The isolated login profile was retained; pass --profile to remove it too.");
}
