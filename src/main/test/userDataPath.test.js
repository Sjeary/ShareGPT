const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { applyStableUserDataPath, copyMissingUserDataEntries } = require("../userDataPath");

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-user-data-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("packaged upgrades keep appData/ShareGPT and never overwrite existing target data", (t) => {
  const root = tempRoot(t);
  const legacy = path.join(root, "legacy-sender");
  const stable = path.join(root, "ShareGPT");
  fs.mkdirSync(path.join(legacy, "Partitions", "gpt"), { recursive: true });
  fs.mkdirSync(path.join(stable, "Partitions", "gpt"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "settings.json"), "legacy-settings");
  fs.writeFileSync(path.join(legacy, "chat_history.json"), "chat-history");
  fs.writeFileSync(path.join(stable, "settings.json"), "current-settings");
  fs.writeFileSync(path.join(stable, "Partitions", "gpt", "Local State"), "current-state");
  fs.writeFileSync(path.join(legacy, "Partitions", "gpt", "Cookies"), "session-cookie");

  const paths = { userData: legacy, appData: root };
  const app = {
    isPackaged: true,
    getPath: (name) => paths[name],
    setPath: (name, value) => (paths[name] = value),
  };
  assert.equal(
    applyStableUserDataPath(app, { SHAREGPT_USER_DATA: path.join(root, "ignored") }),
    stable,
  );
  assert.equal(paths.userData, stable);
  assert.equal(fs.readFileSync(path.join(stable, "settings.json"), "utf8"), "current-settings");
  assert.equal(fs.readFileSync(path.join(stable, "chat_history.json"), "utf8"), "chat-history");
  assert.equal(fs.existsSync(path.join(stable, "Partitions", "gpt", "Cookies")), false);
  assert.equal(
    fs.readFileSync(path.join(stable, "Partitions", "gpt", "Local State"), "utf8"),
    "current-state",
  );
  const report = JSON.parse(
    fs.readFileSync(path.join(stable, "user_data_migration_report.json"), "utf8"),
  );
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].partition, "gpt");
});

test("a missing Chromium partition is copied as one complete directory", (t) => {
  const root = tempRoot(t);
  const legacy = path.join(root, "legacy");
  const stable = path.join(root, "stable");
  fs.mkdirSync(path.join(legacy, "Partitions", "claude", "Network"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "Partitions", "claude", "Cookies"), "cookies");
  fs.writeFileSync(path.join(legacy, "Partitions", "claude", "Network", "State"), "state");

  const conflicts = copyMissingUserDataEntries(legacy, stable);
  assert.deepEqual(conflicts, []);
  assert.equal(
    fs.readFileSync(path.join(stable, "Partitions", "claude", "Cookies"), "utf8"),
    "cookies",
  );
  assert.equal(
    fs.readFileSync(path.join(stable, "Partitions", "claude", "Network", "State"), "utf8"),
    "state",
  );
});

test("missing or identical migration sources are no-ops", (t) => {
  const root = tempRoot(t);
  copyMissingUserDataEntries("", root);
  copyMissingUserDataEntries(path.join(root, "missing"), root);
  copyMissingUserDataEntries(root, root);
  assert.deepEqual(fs.readdirSync(root), []);
});

test("development may use an explicit isolated directory without migration", (t) => {
  const root = tempRoot(t);
  const isolated = path.join(root, "dev-profile");
  const paths = { userData: path.join(root, "legacy"), appData: root };
  const app = {
    isPackaged: false,
    getPath: (name) => paths[name],
    setPath: (name, value) => (paths[name] = value),
  };
  assert.equal(applyStableUserDataPath(app, { SHAREGPT_USER_DATA: isolated }), isolated);
  assert.equal(paths.userData, isolated);
  assert.equal(fs.existsSync(isolated), true);
});

test("a migration read failure keeps the legacy directory active", (t) => {
  const root = tempRoot(t);
  const legacyFile = path.join(root, "not-a-directory");
  fs.writeFileSync(legacyFile, "existing-data");
  const paths = { userData: legacyFile, appData: root };
  const app = {
    isPackaged: true,
    getPath: (name) => paths[name],
    setPath: (name, value) => (paths[name] = value),
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(applyStableUserDataPath(app, {}), legacyFile);
    assert.equal(paths.userData, legacyFile);
  } finally {
    console.warn = originalWarn;
  }
});
