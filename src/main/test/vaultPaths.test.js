const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { VaultManager } = require("../vault");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-vault-paths-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const vault = new VaultManager({ getPath: () => directory }, () => null);
  fs.mkdirSync(vault.root);
  const outside = path.join(directory, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.md"), "outside sentinel");
  return { vault, outside, directory };
}

test("vault normal nested files retain read/write/create/rename/remove behavior", async (t) => {
  const { vault } = fixture(t);
  await vault.create("folder/note.md", "first");
  await vault.write("folder/note.md", "second");
  assert.equal((await vault.read("folder/note.md")).content, "second");
  await vault.rename("folder/note.md", "other/note.md");
  assert.equal((await vault.read("other/note.md")).content, "second");
  await vault.remove("other/note.md");
  assert.deepEqual(await vault.list(), []);
  for (const invalid of ["", "../outside/secret.md", "C:\\outside\\secret.md", "/etc/passwd"]) {
    await assert.rejects(vault.read(invalid));
  }
});

test("vault descendant symlinks and Windows junctions cannot read, write, rename or delete outside", async (t) => {
  const { vault, outside } = fixture(t);
  fs.symlinkSync(
    outside,
    path.join(vault.root, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await vault.create("safe.md", "safe");
  await assert.rejects(vault.read("linked/secret.md"));
  assert.equal(await vault.readBinary("linked/secret.md"), null);
  await assert.rejects(vault.write("linked/new.md", "escape"));
  await assert.rejects(vault.create("linked/new.md", "escape"));
  await assert.rejects(vault.rename("safe.md", "linked/new.md"));
  await assert.rejects(vault.rename("linked/secret.md", "stolen.md"));
  await assert.rejects(vault.remove("linked/secret.md"));
  assert.equal(fs.readFileSync(path.join(outside, "secret.md"), "utf8"), "outside sentinel");
  assert.deepEqual(fs.readdirSync(outside), ["secret.md"]);
  assert.equal((await vault.read("safe.md")).content, "safe");
});

test("a user-selected root alias works while import cannot follow a linked destination", async (t) => {
  const { vault, outside, directory } = fixture(t);
  const originalRoot = vault.root;
  const alias = path.join(directory, "root-alias");
  fs.symlinkSync(originalRoot, alias, process.platform === "win32" ? "junction" : "dir");
  vault.root = alias;
  assert.equal((await vault.create("note.md", "through selected root")).path, "note.md");
  assert.equal((await vault.read("note.md")).content, "through selected root");
  fs.symlinkSync(
    outside,
    path.join(originalRoot, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const source = path.join(directory, "import");
  fs.mkdirSync(path.join(source, "linked"), { recursive: true });
  fs.writeFileSync(path.join(source, "linked", "new.md"), "escape");
  vault.restartWatch = async () => {};
  const result = await vault.importFrom(source);
  assert.equal(result.skipped, 1);
  assert.equal(fs.existsSync(path.join(outside, "new.md")), false);
});
