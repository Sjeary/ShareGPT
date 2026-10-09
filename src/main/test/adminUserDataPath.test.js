const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { configureAdminUserData } = require("../../../admin_console/src/main/userDataPath");

function fixture(t, isPackaged = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-admin-profile-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = { appData: path.join(root, "app-data") };
  fs.mkdirSync(paths.appData);
  const app = {
    isPackaged,
    getAppPath: () => path.join(root, "checkout"),
    getPath: (name) => paths[name],
    setPath: (name, value) => {
      paths[name] = value;
    },
    setAppLogsPath: (value) => {
      paths.logs = value;
    },
  };
  return { root, app, paths, installed: path.join(paths.appData, "ShareGPT Admin") };
}

test("admin development defaults to its checkout before application readiness", (t) => {
  const f = fixture(t);
  const main = fs.readFileSync(
    path.resolve(__dirname, "../../../admin_console/src/main/main.js"),
    "utf8",
  );
  const stop = new Error("ready boundary");
  Object.assign(f.app, {
    setName() {},
    whenReady() {
      assert.equal(f.paths.userData, path.join(f.root, "checkout", ".cache", "user-data"));
      assert.equal(f.paths.sessionData, f.paths.userData);
      assert.equal(f.paths.logs, path.join(f.paths.userData, "logs"));
      throw stop;
    },
  });
  assert.throws(
    () =>
      vm.runInNewContext(main, {
        require: (name) =>
          name === "electron"
            ? { app: f.app }
            : name === "./userDataPath"
              ? { configureAdminUserData: (app) => configureAdminUserData(app, {}) }
              : require(name),
        process: { env: {}, platform: process.platform },
      }),
    (error) => error === stop,
  );
  assert.equal(fs.existsSync(f.installed), false);
});

test("test overrides remain isolated and the packaged admin keeps its established path", (t) => {
  const f = fixture(t);
  const override = path.join(f.root, "test-data");
  assert.equal(
    configureAdminUserData(f.app, { SHAREGPT_ADMIN_TEST_USER_DATA: override }),
    override,
  );
  f.app.isPackaged = true;
  assert.equal(
    configureAdminUserData(f.app, { SHAREGPT_ADMIN_TEST_USER_DATA: override }),
    f.installed,
  );
});

test("admin development rejects the installed profile, its parents/children and symlink aliases", (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.installed);
  const alias = path.join(f.root, "alias");
  fs.symlinkSync(f.installed, alias, process.platform === "win32" ? "junction" : "dir");
  for (const directory of [
    f.installed,
    f.paths.appData,
    path.join(f.installed, "nested"),
    alias,
    path.join(alias, "not-created"),
  ]) {
    assert.throws(
      () => configureAdminUserData(f.app, { SHAREGPT_ADMIN_TEST_USER_DATA: directory }),
      /separate/,
    );
  }
  assert.equal(f.paths.userData, undefined);
});
