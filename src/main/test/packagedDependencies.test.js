const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { finished } = require("node:stream/promises");
const asar = require("@electron/asar");
const { FileMatcher } = require("app-builder-lib/out/fileMatcher");
const { verifyPackagedDependencies } = require("../../../scripts/verify-packaged-dependencies.cjs");

async function fixture(t, packages) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sharegpt-package-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [directory, manifest] of Object.entries(packages)) {
    const target = path.join(root, "source", directory);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "package.json"), JSON.stringify(manifest));
  }
  const archive = path.join(root, "app.asar");
  // asar 3 returns the output stream before its final writes have completed.
  const output = await asar.createPackage(path.join(root, "source"), archive);
  await finished(output);
  return archive;
}

test("packaged verification rejects a missing transitive dependency", async (t) => {
  const archive = await fixture(t, {
    "": { name: "app", dependencies: { agent: "1" } },
    "node_modules/agent": { name: "agent", dependencies: { transport: "1" } },
  });
  assert.throws(() => verifyPackagedDependencies(archive), /agent requires transport/);
});

for (const location of ["node_modules/transport", "node_modules/agent/node_modules/transport"]) {
  test(`packaged verification resolves ${location}`, async (t) => {
    const archive = await fixture(t, {
      "": { name: "app", dependencies: { agent: "1" } },
      "node_modules/agent": { name: "agent", dependencies: { transport: "1" } },
      [location]: { name: "transport" },
    });
    assert.equal(verifyPackagedDependencies(archive), 3);
  });
}

test("packaged verification resolves Windows archive separators", async (t) => {
  const archive = await fixture(t, {
    "": { name: "app", dependencies: { transport: "1" } },
    "node_modules/transport": { name: "transport" },
  });
  const listPackage = asar.listPackage.bind(asar);
  t.mock.method(asar, "listPackage", (...args) =>
    listPackage(...args).map((file) => file.replace(/\//g, "\\")),
  );
  assert.equal(verifyPackagedDependencies(archive), 2);
});

test("desktop package filters produce a portable shared policy and server ships its own policy closure", async (t) => {
  const root = path.resolve(__dirname, "../../..");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "sharegpt-shared-policy-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const config = JSON.parse(await fs.readFile(path.join(root, "build.sender.json"), "utf8"));
  const filter = new FileMatcher(root, root, (value) => value, config.files).createFilter();
  for (const relative of [
    "src/main/endpointSecurity.js",
    "collab_server2/shared/endpointSecurity.js",
  ]) {
    const source = path.join(root, relative);
    assert.equal(filter(source, await fs.stat(source)), true, relative);
    const target = path.join(temp, "source", relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }
  const archive = path.join(temp, "policy.asar");
  await finished(await asar.createPackage(path.join(temp, "source"), archive));
  asar.extractAll(archive, path.join(temp, "unpacked"));
  const desktop = require(path.join(temp, "unpacked/src/main/endpointSecurity.js"));
  const standalone = require(path.join(temp, "unpacked/collab_server2/shared/endpointSecurity.js"));
  assert.equal(desktop.classifyIpAddress("64:ff9b::a00:1"), "private");
  assert.equal(standalone.classifyIpAddress("1.1.1.1"), "public");
});
