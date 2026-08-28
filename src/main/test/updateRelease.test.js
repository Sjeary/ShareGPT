const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildUpdateReleaseInfo,
  releaseAssetName,
  releaseVersionFromLatestUrl,
} = require("../updateRelease");

test("latest GitHub tag is the authoritative update version", () => {
  const info = buildUpdateReleaseInfo({
    repo: "Sjeary/ShareGPT",
    latestUrl: "https://github.com/Sjeary/ShareGPT/releases/tag/v1.0.8",
    ymlText: "version: 6.0.0\npath: sharegpt-sender-6.0.0.exe\n",
    platform: "win32",
    arch: "x64",
  });
  assert.equal(info.version, "1.0.8");
  assert.equal(info.fileName, "sharegpt-sender-1.0.8.exe");
  assert.match(info.url, /releases\/download\/v1\.0\.8\/sharegpt-sender-1\.0\.8\.exe$/);
});

test("matching updater metadata may provide the Windows asset filename", () => {
  assert.equal(
    releaseAssetName(
      "1.0.9",
      "win32",
      "x64",
      "version: 1.0.9\npath: sharegpt-sender-1.0.9.exe\n",
    ),
    "sharegpt-sender-1.0.9.exe",
  );
  assert.equal(releaseAssetName("1.0.9", "darwin", "arm64"), "sharegpt-sender-1.0.9-arm64.dmg");
});

test("latest redirect must belong to the configured repository and contain a release semver", () => {
  assert.equal(
    releaseVersionFromLatestUrl(
      "https://github.com/Sjeary/ShareGPT/releases/tag/v1.0.9",
      "Sjeary/ShareGPT",
    ),
    "1.0.9",
  );
  assert.equal(
    releaseVersionFromLatestUrl(
      "https://github.com/other/ShareGPT/releases/tag/v9.0.0",
      "Sjeary/ShareGPT",
    ),
    "",
  );
  assert.equal(
    releaseVersionFromLatestUrl(
      "https://github.com/Sjeary/ShareGPT/releases/tag/latest",
      "Sjeary/ShareGPT",
    ),
    "",
  );
});
