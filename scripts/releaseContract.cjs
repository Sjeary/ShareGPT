const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const EXPECTED_APP_ID = "com.sjeary.sharegpt.desktop";

/**
 * @typedef {{
 *   version?: unknown,
 *   build?: { appId?: unknown, win?: { artifactName?: unknown, executableName?: unknown } }
 * }} ReleasePackageJson
 * @typedef {{ version?: unknown, packages?: { ""?: { version?: unknown } } }} ReleasePackageLock
 * @typedef {{
 *   appId?: unknown,
 *   mac?: { artifactName?: unknown },
 *   extraMetadata?: { name?: unknown }
 * }} SenderBuild
 * @typedef {{
 *   windows?: { appId?: unknown, artifactName?: unknown },
 *   mac?: { legacyAppId?: unknown, legacyArtifactName?: unknown }
 * }} ReleaseCompatibility
 */

/**
 * @param {{
 *   packageJson?: ReleasePackageJson,
 *   packageLock?: ReleasePackageLock,
 *   senderBuild?: SenderBuild,
 *   compatibility?: ReleaseCompatibility,
 *   releaseTag?: string
 * }} input
 */
function releaseContractFailures({
  packageJson = {},
  packageLock = {},
  senderBuild = {},
  compatibility = {},
  releaseTag = "",
}) {
  const version = String(packageJson?.version || "").trim();
  const failures = [];
  const requireEqual = (label, actual, expected) => {
    if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
  };

  if (!RELEASE_VERSION_PATTERN.test(version)) {
    failures.push(`package version: expected semantic version, got ${version}`);
  }
  requireEqual("package-lock version", packageLock?.version, version);
  requireEqual("package-lock root version", packageLock?.packages?.[""]?.version, version);
  requireEqual("desktop appId", packageJson?.build?.appId, EXPECTED_APP_ID);
  requireEqual("macOS appId", senderBuild?.appId, EXPECTED_APP_ID);
  requireEqual(
    "Windows artifact",
    packageJson?.build?.win?.artifactName,
    "sharegpt-${version}.${ext}",
  );
  requireEqual("Windows executable", packageJson?.build?.win?.executableName, "sharegpt");
  requireEqual(
    "macOS artifact",
    senderBuild?.mac?.artifactName,
    "sharegpt-${version}-${arch}.${ext}",
  );
  requireEqual("macOS package name", senderBuild?.extraMetadata?.name, "sharegpt-desktop");
  requireEqual("legacy Windows appId", compatibility?.windows?.appId, EXPECTED_APP_ID);
  requireEqual(
    "legacy Windows artifact",
    compatibility?.windows?.artifactName,
    "sharegpt-${version}.exe",
  );
  requireEqual(
    "legacy macOS appId",
    compatibility?.mac?.legacyAppId,
    "com.sjeary.sharegpt.desktop.sender",
  );
  requireEqual(
    "legacy macOS download alias",
    compatibility?.mac?.legacyArtifactName,
    "sharegpt-sender-${version}-arm64.dmg",
  );
  if (releaseTag) requireEqual("release tag", releaseTag, `v${version}`);

  return failures;
}

module.exports = {
  EXPECTED_APP_ID,
  RELEASE_VERSION_PATTERN,
  releaseContractFailures,
};
