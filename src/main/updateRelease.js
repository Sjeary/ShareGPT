const path = require("node:path");

const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function safeReleaseVersion(value) {
  const version = String(value || "")
    .trim()
    .replace(/^v/i, "");
  return RELEASE_VERSION_PATTERN.test(version) ? version : "";
}

function releaseVersionFromLatestUrl(value, repo) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") return "";
    const normalizedRepo = String(repo || "").replace(/^\/+|\/+$/g, "");
    if (!normalizedRepo) return "";
    const expectedPrefix = `/${normalizedRepo}/releases/tag/`;
    if (!url.pathname.startsWith(expectedPrefix)) return "";
    return safeReleaseVersion(decodeURIComponent(url.pathname.slice(expectedPrefix.length)));
  } catch {
    return "";
  }
}

function releaseAssetName(version, platform, arch, ymlText = "") {
  const safeVersion = safeReleaseVersion(version);
  if (!safeVersion) return "";
  if (platform === "darwin") {
    const safeArch = arch === "x64" ? "x64" : "arm64";
    return `sharegpt-${safeVersion}-${safeArch}.dmg`;
  }

  const ymlVersion = safeReleaseVersion(String(ymlText).match(/^version:\s*(.+)$/m)?.[1]);
  const ymlPath = String(ymlText).match(/^path:\s*(.+)$/m)?.[1] || "";
  const ymlFileName = path.basename(ymlPath.trim().replace(/^['"]|['"]$/g, ""));
  const expectedWindowsName = `sharegpt-${safeVersion}.exe`;
  if (
    ymlVersion === safeVersion &&
    ymlFileName.toLowerCase() === expectedWindowsName.toLowerCase()
  ) {
    return ymlFileName;
  }
  return expectedWindowsName;
}

function buildUpdateReleaseInfo({ repo, latestUrl, ymlText, platform, arch }) {
  const version = releaseVersionFromLatestUrl(latestUrl, repo);
  if (!version) return null;
  const tag = `v${version}`;
  const fileName = releaseAssetName(version, platform, arch, ymlText);
  return {
    version,
    notes: "",
    publishedAt: "",
    url: `https://github.com/${repo}/releases/download/${tag}/${fileName}`,
    fileName,
    htmlUrl: `https://github.com/${repo}/releases/tag/${tag}`,
    repo,
  };
}

function assertManualUpdateRequest(expected, requested) {
  const expectedVersion = safeReleaseVersion(expected?.version);
  const requestedVersion = safeReleaseVersion(requested?.version);
  const expectedFileName = path.basename(String(expected?.fileName || ""));
  const requestedFileName = path.basename(String(requested?.fileName || ""));
  let expectedUrl = "";
  let requestedUrl = "";
  try {
    expectedUrl = new URL(String(expected?.url || "")).toString();
    requestedUrl = new URL(String(requested?.url || "")).toString();
  } catch {}
  if (
    !expectedVersion ||
    expectedVersion !== requestedVersion ||
    !expectedFileName ||
    expectedFileName.toLowerCase() !== requestedFileName.toLowerCase() ||
    !expectedUrl ||
    expectedUrl !== requestedUrl
  ) {
    throw new Error("更新信息已变化，请重新检查 GitHub 最新版本后再下载");
  }
  return { version: expectedVersion, fileName: expectedFileName, url: expectedUrl };
}

module.exports = {
  assertManualUpdateRequest,
  buildUpdateReleaseInfo,
  releaseAssetName,
  releaseVersionFromLatestUrl,
  safeReleaseVersion,
};
