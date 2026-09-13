const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
// This test-only parser has no declarations; do not typecheck its dependency sources as app code.
const yaml = createRequire(__filename)("js-yaml");
const {
  legacyReleaseCommands,
  legacyReleaseEnvironment,
} = require("../../../scripts/build-legacy-release.cjs");
const { releaseDistribution } = require("../../../scripts/release-distribution.cjs");

test("legacy publishing is restricted to the exact approved version and tag", () => {
  for (const [version, tag] of [
    ["1.0.11", "v1.0.11"],
    ["1.0.10-beta.1", "v1.0.10-beta.1"],
    ["1.0.10", "v1.0.9"],
    ["1.0.9", "main"],
    ["1.0.9", undefined],
    ["1.0.8", "v1.0.9"],
  ]) {
    assert.throws(
      () => legacyReleaseCommands({ version, tag, platform: "darwin" }),
      /approved exact release|matching release version and tag/,
    );
  }
  assert.throws(
    () => legacyReleaseCommands({ version: "1.0.9", tag: "v1.0.9", platform: "linux" }),
    /only macOS and Windows/,
  );
});

for (const version of ["1.0.9", "1.0.10"]) {
  test(`${version} macOS builds fresh, signs ad-hoc, verifies, then packages`, () => {
    const steps = legacyReleaseCommands({ version, tag: `v${version}`, platform: "darwin" });
    assert.equal(steps.length, 7);
    assert.ok(steps[3][1].includes("dir"));
    assert.equal(steps[4][1][0], "scripts/sign-local-macos.mjs");
    assert.deepEqual(steps[5], [
      "codesign",
      ["--verify", "--deep", "--strict", "release_sender/mac-arm64/ShareGPT.app"],
    ]);
    assert.ok(steps[6][1].includes("--prepackaged"));
    for (const index of [3, 6]) {
      assert.ok(steps[index][1].includes("-c.mac.notarize=false"));
      assert.ok(steps[index][1].includes("--arm64"));
      assert.equal(steps[index][1].at(-1), "never");
    }
  });

  test(`${version} Windows keeps canonical NSIS and prevents implicit upload`, () => {
    const steps = legacyReleaseCommands({ version, tag: `v${version}`, platform: "win32" });
    assert.equal(steps.length, 4);
    assert.deepEqual(steps[3][1], [
      "node_modules/electron-builder/cli.js",
      "--win",
      "nsis",
      "--x64",
      "--publish",
      "never",
    ]);
  });
}

test("unapproved versions always retain the official signing policy", () => {
  for (const version of ["1.0.8", "1.0.11", "1.0.100", "2.0.0", "1.0.10-beta.1"]) {
    assert.equal(releaseDistribution({ version, tag: `v${version}` }), "official");
  }
  for (const version of ["1.0.9", "1.0.10"]) {
    assert.equal(releaseDistribution({ version, tag: `v${version}` }), "legacy");
  }
  assert.throws(() => releaseDistribution({ version: "invalid", tag: "vinvalid" }), /matching/);
});

test("legacy build does not consume inherited signing credentials", () => {
  const input = {
    PATH: "fixture-path",
    CSC_LINK: "fixture",
    CSC_KEY_PASSWORD: "fixture",
    WIN_CSC_LINK: "fixture",
    WIN_CSC_KEY_PASSWORD: "fixture",
  };
  assert.deepEqual(legacyReleaseEnvironment(input), {
    PATH: "fixture-path",
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  });
  assert.equal(input.CSC_LINK, "fixture", "the parent environment must not be changed");
});

test("release jobs consume the single exact-version distribution policy", () => {
  const workflow = yaml.load(
    fs.readFileSync(path.join(__dirname, "../../../.github/workflows/release.yml"), "utf8"),
  );
  for (const job of [workflow.jobs.macos, workflow.jobs.windows]) {
    for (const step of job.steps) {
      if (/approved legacy/i.test(step.name || "")) {
        assert.equal(step.if, "needs.source.outputs.distribution == 'legacy'");
      }
      if (
        Object.keys(step.env || {}).some((key) =>
          /CSC|APPLE_API|EXPECTED_.*(TEAM|PUBLISHER)/.test(key),
        )
      ) {
        assert.equal(step.if, "needs.source.outputs.distribution == 'official'");
      }
    }
  }
  assert.equal(workflow.jobs.source.outputs.distribution, "${{ steps.distribution.outputs.mode }}");
  const distribution = workflow.jobs.source.steps.find((step) => step.id === "distribution");
  assert.match(distribution.run, /node scripts\/release-distribution\.cjs/);
  assert.match(
    workflow.jobs.source.steps.find(
      (step) => step.name === "Verify protected release source and contract",
    ).run,
    /test -s "docs\/releases\/\$SHAREGPT_RELEASE_TAG\.md"/,
  );
  const ci = yaml.load(
    fs.readFileSync(path.join(__dirname, "../../../.github/workflows/ci.yml"), "utf8"),
  );
  assert.match(
    ci.jobs["electron-integration"].steps.find(
      (step) => step.name === "Verify approved legacy Mac packaging and real packaged startup",
    ).run,
    /node scripts\/release-distribution\.cjs/,
  );
  const publish = workflow.jobs.publish;
  assert.deepEqual(publish.needs, ["source", "macos", "windows"]);
  assert.match(publish.steps.at(-1).run, /--notes-file/);
  assert.doesNotMatch(publish.steps.at(-1).run, /--generate-notes/);
});
