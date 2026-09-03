const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const EXPECTED_APP_ID = "com.sjeary.sharegpt.desktop";
const EXPECTED_PRODUCT_NAME = "ShareGPT";

function workflowJob(source, name) {
  const text = String(source || "");
  const match = new RegExp(`^  ${name}:\\s*$`, "m").exec(text);
  if (!match) return "";
  const start = match.index;
  const remaining = text.slice(start + match[0].length);
  const next = /^  [A-Za-z][A-Za-z0-9_-]*:\s*$/m.exec(remaining);
  return text.slice(start, next ? start + match[0].length + next.index : undefined);
}

function releaseWorkflowFailures(source) {
  const text = String(source || "");
  const failures = [];
  if (!/^\s{4}tags:\s*\["v\*"\]\s*$/m.test(text)) {
    failures.push("release workflow: must run only for v* tag pushes");
  }
  if (/^\s{2}workflow_dispatch:\s*$/m.test(text)) {
    failures.push("release workflow: manual non-tag dispatch must remain disabled");
  }
  const sourceJob = workflowJob(text, "source");
  const macosJob = workflowJob(text, "macos");
  const windowsJob = workflowJob(text, "windows");
  if (!sourceJob) failures.push("release workflow: source verification job is required");
  if (sourceJob.includes("secrets.")) {
    failures.push("release workflow: source verification must run without signing secrets");
  }
  for (const [name, job] of [
    ["macos", macosJob],
    ["windows", windowsJob],
  ]) {
    if (!job) {
      failures.push(`release workflow: ${name} job is required`);
      continue;
    }
    if (!/^\s{4}needs:\s*source\s*$/m.test(job)) {
      failures.push(`release workflow: ${name} must wait for the source job`);
    }
    if (/^\s{4}env:\s*$/m.test(job)) {
      failures.push(`release workflow: ${name} signing secrets must not use job-level env`);
    }
  }
  const assetDownload = macosJob.indexOf("Download and verify pinned macOS proxy binary");
  const apiKeyPreparation = macosJob.indexOf("Prepare App Store Connect API key");
  if (assetDownload < 0 || apiKeyPreparation < 0 || assetDownload > apiKeyPreparation) {
    failures.push("release workflow: pinned assets must download before the API key is created");
  }
  if (!macosJob.includes('rm -f "$APPLE_API_KEY"')) {
    failures.push("release workflow: temporary App Store Connect key must be deleted");
  }
  return failures;
}

/**
 * @typedef {{
 *   version?: unknown,
 *   scripts?: Record<string, unknown>,
 *   build?: {
 *     appId?: unknown,
 *     productName?: unknown,
 *     publish?: Array<{ provider?: unknown, owner?: unknown, repo?: unknown }>,
 *     win?: { artifactName?: unknown, executableName?: unknown, signAndEditExecutable?: unknown }
 *   }
 * }} ReleasePackageJson
 * @typedef {{ version?: unknown, packages?: { ""?: { version?: unknown } } }} ReleasePackageLock
 * @typedef {{
 *   appId?: unknown,
 *   productName?: unknown,
 *   mac?: { artifactName?: unknown, hardenedRuntime?: unknown, notarize?: unknown },
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
 * }} [input]
 */
function releaseContractFailures({
  packageJson = {},
  packageLock = {},
  senderBuild = {},
  compatibility = {},
  releaseTag = "",
} = {}) {
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
  requireEqual("desktop productName", packageJson?.build?.productName, EXPECTED_PRODUCT_NAME);
  requireEqual("macOS productName", senderBuild?.productName, EXPECTED_PRODUCT_NAME);
  const publish = Array.isArray(packageJson?.build?.publish) ? packageJson.build.publish : [];
  requireEqual("desktop update provider count", publish.length, 1);
  requireEqual("desktop update provider", publish[0]?.provider, "github");
  requireEqual("desktop update owner", publish[0]?.owner, "Sjeary");
  requireEqual("desktop update repository", publish[0]?.repo, "ShareGPT");
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
  requireEqual("public macOS hardened runtime", senderBuild?.mac?.hardenedRuntime, true);
  requireEqual("public macOS notarization", senderBuild?.mac?.notarize, true);
  requireEqual("Windows executable signing", packageJson?.build?.win?.signAndEditExecutable, true);
  const windowsInstallerCommand = String(packageJson?.scripts?.["dist:win:installer"] || "");
  if (!windowsInstallerCommand.includes("--publish never")) {
    failures.push("Windows verification build: must disable implicit publishing");
  }
  const publicMacCommand = String(packageJson?.scripts?.["dist:mac"] || "");
  const localMacCommand = String(packageJson?.scripts?.["dist:mac:sender:local"] || "");
  if (!publicMacCommand.includes("build.sender.json") || publicMacCommand.includes("sign-local")) {
    failures.push("public macOS build: must use the official sender config without local signing");
  }
  for (const required of [
    "CSC_IDENTITY_AUTO_DISCOVERY=false",
    "-c.mac.notarize=false",
    "-c.mac.hardenedRuntime=false",
    "sign-local-macos.sh",
  ]) {
    if (!localMacCommand.includes(required)) {
      failures.push(`local macOS build: missing explicit local-only boundary ${required}`);
    }
  }
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
  EXPECTED_PRODUCT_NAME,
  RELEASE_VERSION_PATTERN,
  releaseContractFailures,
  releaseWorkflowFailures,
};
