const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const asar = require("@electron/asar");
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
  await asar.createPackage(path.join(root, "source"), archive);
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
