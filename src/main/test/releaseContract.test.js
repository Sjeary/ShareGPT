const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { releaseContractFailures } = require("../../../scripts/releaseContract.cjs");

const root = path.resolve(__dirname, "../../..");

function validContract() {
  return {
    packageJson: {
      version: "1.0.9",
      build: {
        appId: "com.sjeary.sharegpt.desktop",
        win: { artifactName: "sharegpt-${version}.${ext}", executableName: "sharegpt" },
      },
    },
    packageLock: { version: "1.0.9", packages: { "": { version: "1.0.9" } } },
    senderBuild: {
      appId: "com.sjeary.sharegpt.desktop",
      mac: { artifactName: "sharegpt-${version}-${arch}.${ext}" },
      extraMetadata: { name: "sharegpt-desktop" },
    },
    compatibility: {
      windows: {
        appId: "com.sjeary.sharegpt.desktop",
        artifactName: "sharegpt-${version}.exe",
      },
      mac: {
        legacyAppId: "com.sjeary.sharegpt.desktop.sender",
        legacyArtifactName: "sharegpt-sender-${version}-arm64.dmg",
      },
    },
    releaseTag: "v1.0.9",
  };
}

function clone(value) {
  return structuredClone(value);
}

test("the complete 1.0.9 release contract is accepted without an upgrade floor", () => {
  const contract = validContract();
  assert.equal(Object.hasOwn(contract.compatibility, "minimumUpgradeableVersion"), false);
  assert.deepEqual(releaseContractFailures(contract), []);
});

/** @type {Array<[string, (contract: ReturnType<typeof validContract>) => void, string]>} */
const invalidContracts = [
  ["semantic package version", (c) => (c.packageJson.version = "release-1.0.9"), "package version"],
  ["lock version", (c) => (c.packageLock.version = "6.0.0"), "package-lock version"],
  ["lock root version", (c) => (c.packageLock.packages[""].version = "6.0.0"), "root version"],
  ["desktop appId", (c) => (c.packageJson.build.appId += ".sender"), "desktop appId"],
  ["macOS appId", (c) => (c.senderBuild.appId += ".sender"), "macOS appId"],
  [
    "Windows artifact name",
    (c) => (c.packageJson.build.win.artifactName = "sharegpt-sender-${version}.${ext}"),
    "Windows artifact",
  ],
  [
    "Windows executable name",
    (c) => (c.packageJson.build.win.executableName = "sharegpt_sender"),
    "Windows executable",
  ],
  [
    "macOS artifact name",
    (c) => (c.senderBuild.mac.artifactName = "sharegpt-sender-${version}-${arch}.${ext}"),
    "macOS artifact",
  ],
  ["macOS package name", (c) => (c.senderBuild.extraMetadata.name = "sharegpt_sender"), "package name"],
  ["legacy Windows appId", (c) => (c.compatibility.windows.appId += ".sender"), "legacy Windows appId"],
  [
    "legacy Windows artifact",
    (c) => (c.compatibility.windows.artifactName = "sharegpt-sender-${version}.exe"),
    "legacy Windows artifact",
  ],
  ["legacy macOS appId", (c) => (c.compatibility.mac.legacyAppId = "wrong"), "legacy macOS appId"],
  [
    "legacy macOS alias",
    (c) => (c.compatibility.mac.legacyArtifactName = "sharegpt-${version}-arm64.dmg"),
    "legacy macOS download alias",
  ],
  ["release tag", (c) => (c.releaseTag = "v6.0.0"), "release tag"],
];

for (const [name, mutate, expectedFailure] of invalidContracts) {
  test(`release contract rejects an invalid ${name}`, () => {
    const contract = clone(validContract());
    mutate(contract);
    assert.ok(
      releaseContractFailures(contract).some((failure) => failure.includes(expectedFailure)),
      `missing failure for ${name}`,
    );
  });
}

test("release contract permits validation before a tag exists", () => {
  const contract = validContract();
  contract.releaseTag = "";
  assert.deepEqual(releaseContractFailures(contract), []);
});

test("release contract reports missing input instead of throwing", () => {
  const failures = releaseContractFailures({});
  assert.ok(failures.some((failure) => failure.includes("package version")));
  assert.ok(failures.some((failure) => failure.includes("package-lock version")));
  assert.ok(failures.some((failure) => failure.includes("legacy macOS download alias")));
});

test("release contract CLI accepts the repository files and exact tag", () => {
  const result = spawnSync(process.execPath, ["scripts/verify-release-contract.mjs"], {
    cwd: root,
    env: { ...process.env, SHAREGPT_RELEASE_TAG: "v1.0.9" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Release contract verified: v1\.0\.9/);
});

test("release contract CLI validates a release candidate before the tag exists", () => {
  const env = { ...process.env };
  delete env.SHAREGPT_RELEASE_TAG;
  const result = spawnSync(process.execPath, ["scripts/verify-release-contract.mjs"], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Release contract verified: v1\.0\.9/);
});

test("release contract CLI rejects a mismatched tag", () => {
  const result = spawnSync(process.execPath, ["scripts/verify-release-contract.mjs"], {
    cwd: root,
    env: { ...process.env, SHAREGPT_RELEASE_TAG: "v6.0.0" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /release tag: expected v1\.0\.9, got v6\.0\.0/);
});
