const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
// This test-only parser has no declarations; do not typecheck its dependency sources as app code.
const yaml = createRequire(__filename)("js-yaml");
const { legacyReleaseCommands } = require("../../../scripts/build-legacy-release.cjs");

test("legacy publishing is restricted to the exact approved version and tag", () => {
  for (const [version, tag] of [
    ["1.0.10", "v1.0.10"],
    ["1.0.9", "main"],
    ["1.0.9", undefined],
    ["1.0.8", "v1.0.9"],
  ]) {
    assert.throws(
      () => legacyReleaseCommands({ version, tag, platform: "darwin" }),
      /only to v1.0.9/,
    );
  }
  assert.throws(
    () => legacyReleaseCommands({ version: "1.0.9", tag: "v1.0.9", platform: "linux" }),
    /only macOS and Windows/,
  );
});

test("macOS builds fresh, reuses the ad-hoc signing primitive, verifies, then packages", () => {
  const steps = legacyReleaseCommands({ version: "1.0.9", tag: "v1.0.9", platform: "darwin" });
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

test("Windows keeps the canonical NSIS configuration and prevents implicit upload", () => {
  const steps = legacyReleaseCommands({ version: "1.0.9", tag: "v1.0.9", platform: "win32" });
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

test("only the exact legacy tag bypasses official signing in the release workflow", () => {
  const workflow = yaml.load(
    fs.readFileSync(path.join(__dirname, "../../../.github/workflows/release.yml"), "utf8"),
  );
  for (const job of [workflow.jobs.macos, workflow.jobs.windows]) {
    for (const step of job.steps) {
      if (step.name?.includes("v1.0.9")) {
        assert.equal(step.if, "github.ref_name == 'v1.0.9'");
      }
      if (
        Object.keys(step.env || {}).some((key) =>
          /CSC|APPLE_API|EXPECTED_.*(TEAM|PUBLISHER)/.test(key),
        )
      ) {
        assert.equal(step.if, "github.ref_name != 'v1.0.9'");
      }
    }
  }
  const publish = workflow.jobs.publish;
  assert.deepEqual(publish.needs, ["source", "macos", "windows"]);
  assert.match(publish.steps.at(-1).run, /--notes-file/);
  assert.doesNotMatch(publish.steps.at(-1).run, /--generate-notes/);
});
