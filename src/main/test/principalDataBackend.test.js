const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Backend } = require("../backend");
const { signLoginIdentity } = require("../../../collab_server2/server_identity");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-owned-data-"));
  const userData = path.join(root, "userData");
  fs.mkdirSync(userData);
  const app = {
    isPackaged: false,
    getName: () => "ShareGPT",
    getVersion: () => "1.0.10-test",
    getPath: (name) => (name === "userData" ? userData : path.join(root, name)),
  };
  const backend = new Backend(app, () => null);
  t.after(async () => {
    await backend.stopDataWatchers();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, userData, backend, app };
}

test("actual Backend routes each account and personal workspace to independent files and vaults", async (t) => {
  const { backend, userData, app } = fixture(t);
  const original = '{"tasks":[{"id":"unassigned"}],"lists":[],"memos":[]}';
  fs.writeFileSync(path.join(userData, "tasks.json"), original);
  backend.init();
  assert.deepEqual(backend.loadTasks().tasks, []);
  backend.activatePrincipal("https://team.example", "Alice");
  const a = backend.getPrincipalContext();
  backend.saveTasks({ lists: [], tasks: [{ id: "A" }], memos: [] });
  backend.saveCalendar({ calendars: [], events: [{ id: "A-event" }] });
  backend.saveFocus({ sessions: [{ id: "A-focus" }] });
  await backend.vault.create("note.md", "A-note");
  const aVault = backend.vault;
  await backend.stopDataWatchers();
  backend.activatePrincipal("https://team.example", "alice");
  assert.notEqual(backend.getPrincipalContext().principalId, a.principalId);
  assert.deepEqual(backend.loadTasks().tasks, []);
  assert.deepEqual(backend.loadCalendar().events, []);
  assert.deepEqual(backend.loadFocus().sessions, []);
  assert.deepEqual(await backend.vault.list(), []);
  await assert.rejects(backend.vault.setRoot(aVault.root));
  await backend.vault.create("note.md", "B-note");
  backend.saveTasks({ tasks: [{ id: "B" }] });
  backend.clearPrincipal();
  assert.deepEqual(backend.loadTasks().tasks, []);
  assert.deepEqual(await backend.vault.list(), []);
  backend.activatePrincipal("https://team.example", "Alice");
  assert.equal(backend.loadTasks().tasks[0].id, "A");
  assert.equal((await backend.vault.read("note.md")).content, "A-note");
  const restarted = new Backend(app, () => null);
  restarted.activatePrincipal("https://team.example", "Alice");
  assert.equal(restarted.loadTasks().tasks[0].id, "A");
  assert.equal((await restarted.vault.read("note.md")).content, "A-note");
  assert.equal(fs.readFileSync(path.join(userData, "tasks.json"), "utf8"), original);
});

test("verified backend address changes keep the same data owner without copying another account", (t) => {
  const { backend, root } = fixture(t);
  const account = { username: "Alice" };
  const keyFile = path.join(root, "server-identity.json");
  const nonce = "a".repeat(64);
  backend.activatePrincipal("https://first.example/team", "Alice", {
    nonce,
    proof: signLoginIdentity(keyFile, account, nonce),
  });
  const original = backend.getPrincipalContext();
  backend.saveTasks({ tasks: [{ id: "kept-through-new-address" }] });
  const nextNonce = "b".repeat(64);
  backend.activatePrincipal("https://second.example/team", "Alice", {
    nonce: nextNonce,
    proof: signLoginIdentity(keyFile, account, nextNonce),
  });
  assert.equal(backend.getPrincipalContext().principalId, original.principalId);
  assert.equal(backend.loadTasks().tasks[0].id, "kept-through-new-address");
});

test("upgrade snapshots include every account directory and the legacy import record", async (t) => {
  const { backend, userData } = fixture(t);
  fs.writeFileSync(
    path.join(userData, "calendar.json"),
    JSON.stringify({ calendars: [], events: [{ id: "legacy" }] }),
  );
  backend.activatePrincipal("https://team.example", "Alice");
  await backend.importLegacyUserData(
    backend.inspectLegacyUserData().find((item) => item.category === "calendar"),
  );
  const target = backend.calendarFile;
  const backup = backend.createUpdateBackup("test-principal-data");
  assert.equal(
    JSON.parse(
      fs.readFileSync(
        path.join(backup.backupDir, path.relative(fs.realpathSync(userData), target)),
        "utf8",
      ),
    ).events[0].id,
    "legacy",
  );
  assert.ok(fs.existsSync(path.join(backup.backupDir, "legacy-data-imports.json")));
  backend.saveCalendar({ calendars: [], events: [{ id: "new-edit" }] });
  backend.restoreMissingDataFromLatestUpdateBackup();
  assert.equal(backend.loadCalendar().events[0].id, "new-edit");
});

test("custom vault choices stay account-owned and explicit legacy import preserves old bytes", async (t) => {
  const { backend, root, userData } = fixture(t);
  const old = '{"lists":[],"tasks":[{"id":"old"}],"memos":[]}';
  fs.writeFileSync(path.join(userData, "tasks.json"), old);
  backend.activatePrincipal("https://team.example", "Alice");
  const preview = backend.inspectLegacyUserData().find((item) => item.category === "tasks");
  await backend.importLegacyUserData(preview);
  assert.equal(backend.loadTasks().tasks[0].id, "old");
  assert.equal(fs.readFileSync(path.join(userData, "tasks.json"), "utf8"), old);
  const external = path.join(root, "external-notes");
  await backend.vault.setRoot(external);
  await backend.vault.create("a.md", "A");
  await backend.stopDataWatchers();
  backend.activatePrincipal("https://team.example", "Bob");
  await assert.rejects(backend.vault.setRoot(external), /其他工作区/);
  assert.equal(
    backend.inspectLegacyUserData().find((item) => item.category === "tasks").canImport,
    false,
  );
  assert.deepEqual(backend.loadTasks().tasks, []);
});
