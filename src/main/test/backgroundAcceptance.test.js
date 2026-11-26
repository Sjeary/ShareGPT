const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { prepareBackgroundAcceptance } = require("../../../scripts/lib/background-acceptance.cjs");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sharegpt-background-startup-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  /** @type {Record<string, string>} */
  const paths = { appData: path.join(directory, "appData") };
  const events = new Map();
  const app = {
    isPackaged: false,
    getPath: (name) => paths[name],
    getAppPath: () => directory,
    setPath: (name, value) => {
      paths[name] = value;
    },
    setAppLogsPath: (value) => {
      paths.logs = value;
    },
    setActivationPolicy() {},
    on: (event, listener) => events.set(event, listener),
  };
  return { directory, app, paths, events };
}

test("standalone Electron acceptance isolates all profile/cache/download/log paths before loading fixtures", (t) => {
  const f = fixture(t);
  const profile = path.join(f.directory, "isolated");
  prepareBackgroundAcceptance(f.app, { SHAREGPT_USER_DATA: profile });
  const canonical = fs.realpathSync(profile);
  for (const name of ["userData", "sessionData", "temp", "crashDumps", "downloads", "logs"])
    assert.ok(f.paths[name] === canonical || f.paths[name].startsWith(canonical + path.sep), name);
  let focusable = true;
  f.events.get("browser-window-created")(null, {
    isVisible: () => false,
    setFocusable: (value) => {
      focusable = value;
    },
  });
  assert.equal(focusable, false);
});

test("standalone acceptance refuses a live installed profile and never relabels packaged apps", (t) => {
  const f = fixture(t);
  const installed = path.join(f.paths.appData, "ShareGPT");
  fs.mkdirSync(installed, { recursive: true });
  assert.throws(
    () => prepareBackgroundAcceptance(f.app, { SHAREGPT_USER_DATA: installed }),
    /separate/,
  );
  assert.equal(f.paths.userData, undefined);
  f.app.isPackaged = true;
  assert.throws(
    () =>
      prepareBackgroundAcceptance(f.app, {
        SHAREGPT_USER_DATA: path.join(f.directory, "candidate"),
      }),
    /source fixtures only/,
  );
  assert.equal(f.app.isPackaged, true);
});
