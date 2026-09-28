#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findLatestAppliedRecord } from "../lib/official-patch-state.mjs";

const record = findLatestAppliedRecord();
if (!record) throw new Error("No applied official patch record was found");
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const helperPath = path.join(projectRoot, "bin", "official-root-helper.mjs");
const authorization = spawnSync(
  "pkexec",
  ["/usr/bin/node", helperPath, "restore", record.manifestPath],
  { stdio: "inherit" },
);
if (authorization.error) throw authorization.error;
if (authorization.status !== 0) {
  throw new Error(`Official restore authorization failed with status ${authorization.status}`);
}
console.log(`Official Codex ${record.manifest.packageVersion} was restored from its backup.`);
