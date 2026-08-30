const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertLatestWindowsContract,
  assertWindowsAppUpdateContract,
  parseLatestWindowsYaml,
  sha512Base64,
} = require("../../../scripts/windowsReleaseContract.cjs");

const installer = Buffer.from("signed installer fixture");
const installerName = "sharegpt-1.0.9.exe";
const installerSha512 = sha512Base64(installer);

function latestYaml(overrides = {}) {
  const values = {
    version: "1.0.9",
    url: installerName,
    path: installerName,
    size: installer.length,
    fileSha512: installerSha512,
    sha512: installerSha512,
    ...overrides,
  };
  return `version: ${values.version}\nfiles:\n  - url: ${values.url}\n    sha512: ${values.fileSha512}\n    size: ${values.size}\npath: ${values.path}\nsha512: ${values.sha512}\nreleaseDate: '2026-08-30T00:00:00Z'\n`;
}

const latestExpectation = {
  version: "1.0.9",
  installerName,
  installerSize: installer.length,
  installerSha512,
};

test("Windows latest.yml exactly binds one canonical installer by SHA-512 and size", () => {
  const parsed = assertLatestWindowsContract(latestYaml(), latestExpectation);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.sha512, installerSha512);
  assert.deepEqual(parseLatestWindowsYaml(latestYaml()), parsed);
});

test("Windows latest.yml rejects wrong names, sizes, hashes, and extra files", () => {
  for (const yaml of [
    latestYaml({ version: "6.0.0" }),
    latestYaml({ path: "other.exe" }),
    latestYaml({ url: "other.exe" }),
    latestYaml({ size: installer.length + 1 }),
    latestYaml({ sha512: "wrong" }),
    latestYaml({ fileSha512: "wrong" }),
    latestYaml().replace(
      "path:",
      `  - url: other.exe\n    sha512: ${installerSha512}\n    size: ${installer.length}\npath:`,
    ),
  ]) {
    assert.throws(() => assertLatestWindowsContract(yaml, latestExpectation));
  }
});

function appUpdateYaml(overrides = {}) {
  return `provider: ${overrides.provider || "github"}\nowner: ${overrides.owner || "Sjeary"}\nrepo: ${overrides.repo || "ShareGPT"}\npublisherName:\n  - ${overrides.publisher || "ShareGPT Official Publisher"}\n`;
}

test("Windows app-update.yml pins GitHub and the expected publisher identity", () => {
  assert.deepEqual(
    assertWindowsAppUpdateContract(appUpdateYaml(), {
      expectedPublisherName: "ShareGPT Official Publisher",
      requirePublisherIdentity: true,
    }),
    {
      provider: "github",
      owner: "Sjeary",
      repo: "ShareGPT",
      publisherNames: ["ShareGPT Official Publisher"],
    },
  );
});

test("Windows app-update.yml rejects another source or signing identity", () => {
  for (const yaml of [
    appUpdateYaml({ provider: "generic" }),
    appUpdateYaml({ owner: "other" }),
    appUpdateYaml({ repo: "Other" }),
    appUpdateYaml({ publisher: "Other Publisher" }),
  ]) {
    assert.throws(() =>
      assertWindowsAppUpdateContract(yaml, {
        expectedPublisherName: "ShareGPT Official Publisher",
        requirePublisherIdentity: true,
      }),
    );
  }
  assert.throws(
    () => assertWindowsAppUpdateContract(appUpdateYaml(), { requirePublisherIdentity: true }),
    /SHAREGPT_EXPECTED_WINDOWS_PUBLISHER/,
  );
});
