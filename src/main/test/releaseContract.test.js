const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  releaseContractFailures,
  releaseWorkflowFailures,
} = require("../../../scripts/releaseContract.cjs");

const root = path.resolve(__dirname, "../../..");
const repositoryVersion = require("../../../package.json").version;
function validContract() {
  return {
    packageJson: {
      version: "1.0.9",
      scripts: {
        "dist:win:installer": "electron-builder --win nsis --publish never",
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
  [
    "Windows verification publishing",
    (c) => (c.packageJson.scripts["dist:win:installer"] = "electron-builder --win nsis"),
    "implicit publishing",
  ],
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

test("release workflow verifies a tag on main before exposing step-scoped signing secrets", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");
  assert.deepEqual(releaseWorkflowFailures(workflow), []);
  for (const [name, invalid, expected] of [
    ["manual dispatch", workflow.replace("  push:\n", "  workflow_dispatch:\n  push:\n"), "dispatch"],
    ["source secret", workflow.replace("  source:\n", "  source:\n    env:\n      TOKEN: ${{ secrets.BAD }}\n"), "without signing secrets"],
    ["mac source dependency", workflow.replace("  macos:\n    needs: source\n", "  macos:\n"), "must wait"],
    ["Windows job secret", workflow.replace("  windows:\n    needs: source\n", "  windows:\n    needs: source\n    env:\n      TOKEN: bad\n"), "job-level env"],
    [
      "API key before download",
      workflow
        .replace("Download and verify pinned macOS proxy binary", "TEMPORARY STEP")
        .replace("Prepare App Store Connect API key", "Download and verify pinned macOS proxy binary")
        .replace("TEMPORARY STEP", "Prepare App Store Connect API key"),
      "before the API key",
    ],
    ["retained API key", workflow.replace('rm -f "$APPLE_API_KEY"', "true"), "must be deleted"],
  ]) {
    assert.ok(
      releaseWorkflowFailures(invalid).some((failure) => failure.includes(expected)),
      `${name} must fail the workflow contract`,
    );
  }
});
