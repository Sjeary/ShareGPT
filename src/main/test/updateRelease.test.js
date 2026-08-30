const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertManualUpdateRequest,
  buildUpdateReleaseInfo,
  releaseAssetName,
  releaseVersionFromLatestUrl,
  safeReleaseVersion,
} = require("../updateRelease");

test("manual download must exactly match the current GitHub Latest result", () => {
  const expected = {
    version: "1.0.9",
    fileName: "sharegpt-1.0.9-arm64.dmg",
    url: "https://github.com/Sjeary/ShareGPT/releases/download/v1.0.9/sharegpt-1.0.9-arm64.dmg",
  };
  assert.deepEqual(assertManualUpdateRequest(expected, { ...expected }), expected);
  assert.throws(
    () => assertManualUpdateRequest(expected, { ...expected, version: "6.0.0" }),
    /GitHub 最新版本/,
  );
  assert.throws(
    () => assertManualUpdateRequest(expected, { ...expected, url: "https://example.com/a.dmg" }),
    /GitHub 最新版本/,
  );
});

test("release version parsing accepts semver and rejects labels", () => {
  assert.equal(safeReleaseVersion(" v1.0.9 "), "1.0.9");
  assert.equal(safeReleaseVersion("1.0.9-rc.1"), "1.0.9-rc.1");
  assert.equal(safeReleaseVersion("latest"), "");
});

test("resolved GitHub tag is authoritative over mismatched latest.yml", () => {
  const info = buildUpdateReleaseInfo({
    repo: "Sjeary/ShareGPT",
    latestUrl: "https://github.com/Sjeary/ShareGPT/releases/tag/v1.0.8",
    ymlText: "version: 6.0.0\npath: sharegpt-6.0.0.exe\n",
    platform: "win32",
    arch: "x64",
  });
  assert.equal(info.version, "1.0.8");
  assert.equal(info.fileName, "sharegpt-1.0.8.exe");
  assert.match(info.url, /v1\.0\.8\/sharegpt-1\.0\.8\.exe$/);
});

test("only matching canonical Windows metadata can name an asset", () => {
  assert.equal(
    releaseAssetName("1.0.9", "win32", "x64", "version: 1.0.9\npath: sharegpt-1.0.9.exe\n"),
    "sharegpt-1.0.9.exe",
  );
  assert.equal(
    releaseAssetName("1.0.9", "win32", "x64", "version: 1.0.9\npath: sharegpt-sender-1.0.9.exe\n"),
    "sharegpt-1.0.9.exe",
  );
  assert.equal(releaseAssetName("1.0.9", "darwin", "arm64"), "sharegpt-1.0.9-arm64.dmg");
});

test("latest redirect must be HTTPS, configured repo, and semver tag", () => {
  assert.equal(
    releaseVersionFromLatestUrl(
      "https://github.com/Sjeary/ShareGPT/releases/tag/v1.0.9",
      "Sjeary/ShareGPT",
    ),
    "1.0.9",
  );
  assert.equal(
    releaseVersionFromLatestUrl(
      "https://github.com/other/ShareGPT/releases/tag/v1.0.9",
      "Sjeary/ShareGPT",
    ),
    "",
  );
  assert.equal(
    releaseVersionFromLatestUrl(
      "http://github.com/Sjeary/ShareGPT/releases/tag/v1.0.9",
      "Sjeary/ShareGPT",
    ),
    "",
  );
  assert.equal(
    buildUpdateReleaseInfo({
      repo: "Sjeary/ShareGPT",
      latestUrl: "not-a-url",
      ymlText: "",
      platform: "win32",
      arch: "x64",
    }),
    null,
  );
});
