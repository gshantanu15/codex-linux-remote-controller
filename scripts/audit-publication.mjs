#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const maximumFileSize = 1024 * 1024;
const ignoredDirectories = new Set([".deps", ".git", "build", "coverage", "node_modules"]);
const forbiddenFiles = [
  { label: "Electron ASAR", pattern: /\.asar$/i },
  { label: "native binary", pattern: /\.node$/i },
  { label: "Debian package", pattern: /\.deb$/i },
  { label: "AppImage", pattern: /\.AppImage$/i },
  { label: "private key file", pattern: /\.(?:key|p12|pfx|pem)$/i },
];
const textPatterns = [
  { label: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "OpenAI-style secret key", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}\b/ },
  { label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { label: "JWT", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { label: "Bearer authorization value", pattern: /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~-]{12,}/i },
  { label: "captured account or challenge identifier", pattern: /\b(?:user|cli|rch)_[A-Za-z0-9_-]{12,}\b/ },
  { label: "personal test device name", pattern: new RegExp("\\b" + ["Shan", "PC"].join("") + "\\b", "i") },
  { label: "personal absolute home path", pattern: /(?:\/home\/|\/Users\/)[A-Za-z0-9._-]+\// },
  { label: "personal Windows profile path", pattern: /[A-Za-z]:\\Users\\[A-Za-z0-9._ -]+\\/ },
];

const home = os.homedir();
if (home && home !== "/") {
  textPatterns.push({
    label: "absolute home-directory path",
    pattern: new RegExp(escapeRegularExpression(home) + "(?:/|\\\\)"),
  });
}

const problems = [];
const files = listCandidateFiles();
for (const relativePath of files) {
  if (path.isAbsolute(relativePath) || relativePath.split(path.sep).includes("..")) {
    problems.push("unsafe repository path: " + relativePath);
    continue;
  }

  const absolutePath = path.join(projectRoot, relativePath);
  const status = fs.lstatSync(absolutePath);
  if (status.isSymbolicLink()) {
    problems.push("symlink requires manual review: " + relativePath);
    continue;
  }
  if (!status.isFile()) continue;

  if (status.size > maximumFileSize) {
    problems.push("file exceeds " + maximumFileSize + " bytes: " + relativePath);
  }
  for (const forbidden of forbiddenFiles) {
    if (forbidden.pattern.test(relativePath)) {
      problems.push(forbidden.label + " must not be published: " + relativePath);
    }
  }

  const contents = fs.readFileSync(absolutePath);
  if (contents.includes(0)) continue;
  const source = contents.toString("utf8");
  for (const candidate of textPatterns) {
    if (candidate.pattern.test(source)) {
      problems.push(candidate.label + " found in " + relativePath);
    }
  }
}

if (problems.length > 0) {
  console.error("Publication audit failed:");
  for (const problem of problems) console.error("- " + problem);
  process.exit(1);
}

console.log("Publication audit passed for " + files.length + " source files.");

function listCandidateFiles() {
  const insideGit = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (insideGit.status === 0) {
    const listed = spawnSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: projectRoot, encoding: "buffer" },
    );
    if (listed.status !== 0) throw new Error(listed.stderr.toString("utf8"));
    return listed.stdout
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .sort();
  }

  const found = [];
  walk(projectRoot, "");
  return found.sort();

  function walk(directory, prefix) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const relativePath = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        walk(path.join(directory, entry.name), relativePath);
      } else {
        found.push(relativePath);
      }
    }
  }
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
}
