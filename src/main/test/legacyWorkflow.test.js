const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
// YAML checks run with the full suite after dependencies are installed, not in source preflight.
const yaml = createRequire(__filename)("js-yaml");
const root = path.resolve(__dirname, "../../..");

test("release jobs consume the single exact-version distribution policy", () => {
  const workflow = yaml.load(
    fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8"),
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
  const ci = yaml.load(fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"));
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

test("source preflight release tests work without node_modules", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-source-preflight-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const item of [
    "package.json",
    "package-lock.json",
    "build.sender.json",
    "release.compatibility.json",
    "scripts",
    "src/main",
    ".github/workflows",
  ]) {
    fs.cpSync(path.join(root, item), path.join(directory, item), { recursive: true });
  }
  assert.equal(fs.existsSync(path.join(directory, "node_modules")), false);
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const command = String(packageJson.scripts["test:release"]);
  assert.ok(command.startsWith("node "));
  const result = spawnSync(process.execPath, command.slice(5).split(/\s+/), {
    cwd: directory,
    env: { ...process.env, NODE_PATH: "" },
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 5000000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
