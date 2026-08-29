import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const senderBuild = readJson("build.sender.json");
const compatibility = readJson("release.compatibility.json");
const expectedAppId = "com.sjeary.sharegpt.desktop";
const version = String(packageJson.version || "").trim();
const failures = [];

function requireEqual(label, actual, expected) {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

requireEqual("package-lock version", packageLock.version, version);
requireEqual("package-lock root version", packageLock.packages?.[""]?.version, version);
requireEqual("desktop appId", packageJson.build?.appId, expectedAppId);
requireEqual("macOS appId", senderBuild.appId, expectedAppId);
requireEqual(
  "Windows artifact",
  packageJson.build?.win?.artifactName,
  "sharegpt-${version}.${ext}",
);
requireEqual("Windows executable", packageJson.build?.win?.executableName, "sharegpt");
requireEqual("macOS artifact", senderBuild.mac?.artifactName, "sharegpt-${version}-${arch}.${ext}");
requireEqual("macOS package name", senderBuild.extraMetadata?.name, "sharegpt-desktop");
requireEqual("legacy Windows appId", compatibility.windows?.appId, expectedAppId);
requireEqual(
  "legacy Windows artifact",
  compatibility.windows?.artifactName,
  "sharegpt-${version}.exe",
);
requireEqual(
  "legacy macOS appId",
  compatibility.mac?.legacyAppId,
  "com.sjeary.sharegpt.desktop.sender",
);
requireEqual(
  "legacy macOS download alias",
  compatibility.mac?.legacyArtifactName,
  "sharegpt-sender-${version}-arm64.dmg",
);

const releaseTag = String(process.env.SHAREGPT_RELEASE_TAG || "").trim();
if (releaseTag) requireEqual("release tag", releaseTag, `v${version}`);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `Release contract verified: v${version}, ${expectedAppId}, sharegpt-${version} artifacts.`,
);
