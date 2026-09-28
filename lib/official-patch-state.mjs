import fs from "node:fs";
import path from "node:path";
import { STATE_ROOT } from "./paths.mjs";

export const OFFICIAL_STATE_ROOT = path.join(STATE_ROOT, "official-installs");

export function listOfficialInstallRecords() {
  if (!fs.existsSync(OFFICIAL_STATE_ROOT)) return [];
  return fs
    .readdirSync(OFFICIAL_STATE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(OFFICIAL_STATE_ROOT, entry.name, "manifest.json"))
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .sort()
    .reverse()
    .map((manifestPath) => ({
      manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8")),
      manifestPath,
      resultPath: path.join(path.dirname(manifestPath), "result.json"),
    }));
}

export function findLatestAppliedRecord() {
  return listOfficialInstallRecords().find(({ resultPath }) => {
    if (!fs.existsSync(resultPath)) return false;
    try {
      return JSON.parse(fs.readFileSync(resultPath, "utf8")).status === "applied";
    } catch {
      return false;
    }
  });
}

export function findAppliedRecordMatching(asarSha256, nativeAddonSha256) {
  return listOfficialInstallRecords().find(({ manifest, resultPath }) => {
    if (!fs.existsSync(resultPath)) return false;
    try {
      const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
      return (
        result.status === "applied" &&
        manifest.patched.asarSha256 === asarSha256 &&
        manifest.patched.nativeAddonSha256 === nativeAddonSha256
      );
    } catch {
      return false;
    }
  });
}
