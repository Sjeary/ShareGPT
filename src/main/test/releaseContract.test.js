const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { releaseContractFailures } = require("../../../scripts/releaseContract.cjs");

const root = path.resolve(__dirname, "../../..");
const repositoryVersion = require("../../../package.json").version;
function validContract() {
  return {
    packageJson: {
      version: "1.0.9",
      scripts: {
        "dist:mac": "electron-builder --mac --config build.sender.json",
        "dist:mac:sender:local":
          "CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac dir --config build.sender.json -c.mac.notarize=false -c.mac.hardenedRuntime=false && bash scripts/sign-local-macos.sh app",
      },
      build: {
        appId: "com.sjeary.sharegpt.desktop",
        productName: "ShareGPT",
        publish: [{ provider: "github", owner: "Sjeary", repo: "ShareGPT" }],
        win: {
          artifactName: "sharegpt-${version}.${ext}",
          executableName: "sharegpt",
          signAndEditExecutable: true,
        },
      },
    },
    packageLock: { version: "1.0.9", packages: { "": { version: "1.0.9" } } },
    senderBuild: {
      appId: "com.sjeary.sharegpt.desktop",
      productName: "ShareGPT",
      mac: {
        artifactName: "sharegpt-${version}-${arch}.${ext}",
        hardenedRuntime: true,
        notarize: true,
      },
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

test("accepts the complete 1.0.9 release and user-data identity contract", () => {
  assert.deepEqual(releaseContractFailures(validContract()), []);
});

/** @type {Array<[string, (contract: ReturnType<typeof validContract>) => unknown, string]>} */
const invalidContracts = [
  ["tag", (c) => (c.releaseTag = "v6.0.0"), "release tag"],
  ["desktop appId", (c) => (c.packageJson.build.appId += ".sender"), "desktop appId"],
  ["mac appId", (c) => (c.senderBuild.appId += ".sender"), "macOS appId"],
  ["user-data product", (c) => (c.senderBuild.productName = "ShareGPT Sender"), "productName"],
  ["public notarization", (c) => (c.senderBuild.mac.notarize = false), "notarization"],
  ["hardened runtime", (c) => (c.senderBuild.mac.hardenedRuntime = false), "hardened"],
  ["Windows signing", (c) => (c.packageJson.build.win.signAndEditExecutable = false), "signing"],
  ["update provider", (c) => (c.packageJson.build.publish[0].provider = "generic"), "provider"],
  ["update owner", (c) => (c.packageJson.build.publish[0].owner = "other"), "owner"],
  ["update repository", (c) => (c.packageJson.build.publish[0].repo = "Other"), "repository"],
  [
    "public local signer",
    (c) => (c.packageJson.scripts["dist:mac"] += " && sign-local"),
    "public macOS build",
  ],
  [
    "local notarization override",
    (c) => (c.packageJson.scripts["dist:mac:sender:local"] = "electron-builder --mac dir"),
    "local-only boundary",
  ],
  ["legacy mac alias", (c) => (c.compatibility.mac.legacyArtifactName = "bad.dmg"), "alias"],
];

for (const [name, mutate, expected] of invalidContracts) {
  test(`rejects invalid ${name}`, () => {
    const contract = structuredClone(validContract());
    mutate(contract);
    assert.ok(releaseContractFailures(contract).some((failure) => failure.includes(expected)));
  });
}

test("CLI validates repository files and exact tag", () => {
  const result = spawnSync(process.execPath, ["scripts/verify-release-contract.mjs"], {
    cwd: root,
    env: { ...process.env, SHAREGPT_RELEASE_TAG: `v${repositoryVersion}` },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("missing contract input reports failures instead of throwing", () => {
  assert.ok(releaseContractFailures().length > 5);
});
