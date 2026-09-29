const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { pathToFileURL } = require("node:url");

async function fixture(devUrl = "") {
  const handlers = new Map(),
    writes = [],
    windows = [];
  const dirname = path.resolve(__dirname, "../../../admin_console/src/main");
  let ready = () => {};
  const app = {
    isPackaged: false,
    setName() {},
    setActivationPolicy() {},
    getPath: () => "/fixture",
    getVersion: () => "fixture",
    on() {},
    whenReady: () => ({
      then: (callback) => {
        ready = callback;
      },
    }),
  };
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: "" },
        isDestroyed: () => false,
        setWindowOpenHandler: (callback) => {
          this.open = callback;
        },
        send() {},
      });
      windows.push(this);
    }
    loadFile(file) {
      this.webContents.mainFrame.url = pathToFileURL(file).href;
    }
    loadURL(url) {
      this.webContents.mainFrame.url = url;
    }
    setWindowButtonVisibility() {}
  }
  const controls = { pick: async () => ({ canceled: false, filePaths: ["/chosen.exe"] }) };
  const mockFs = {
    existsSync: () => true,
    mkdirSync() {},
    readFileSync: () => "{}",
    writeFileSync: (...args) => writes.push(args),
    realpathSync: (file) => file,
    statSync: () => ({ isFile: () => true, size: 1 }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(dirname, "main.js"), "utf8"), {
    __dirname: dirname,
    Buffer,
    console,
    process: {
      env: { SHAREGPT_ADMIN_TEST_HIDDEN: "1", ADMIN_UI_DEV_URL: devUrl },
      platform: process.platform,
    },
    require: (name) => {
      if (name === "electron")
        return {
          app,
          BrowserWindow: Window,
          ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
          dialog: { showOpenDialog: () => controls.pick() },
        };
      if (name === "./userDataPath") return { configureAdminUserData() {} };
      if (name === "node:fs") return mockFs;
      return require(name);
    },
  });
  await ready();
  const window = windows[0],
    sender = window.webContents;
  const event = { sender, senderFrame: sender.mainFrame };
  return { handlers, writes, event, sender, window, controls };
}

test("all administrator IPC checks the exact live main window, frame and document", async () => {
  for (const devUrl of ["", "http://localhost:5173/"]) {
    const f = await fixture(devUrl);
    assert.equal(f.handlers.get("app:version")(f.event), "fixture");
    f.handlers.get("prefs:save")(f.event, { serverUrl: "https://fixture", username: "admin" });
    assert.equal(f.writes.length, 1);
    const original = f.sender.mainFrame.url;
    for (const handler of f.handlers.values()) {
      for (const event of [
        {},
        { ...f.event, sender: {} },
        { ...f.event, senderFrame: { url: original } },
      ]) {
        assert.throws(() => handler(event, { filePath: "/private" }), /无权/);
      }
      f.sender.mainFrame.url = "https://untrusted.example/";
      assert.throws(() => handler(f.event, {}), /无权/);
      f.sender.mainFrame.url = original;
    }
    assert.equal(f.writes.length, 1);
    f.sender.mainFrame.url += "?theme=dark#panel";
    assert.equal(f.handlers.get("app:version")(f.event), "fixture");
    f.sender.isDestroyed = () => true;
    assert.throws(() => f.handlers.get("app:version")(f.event), /无权/);
  }
});

test("external navigation, redirects, popups and webviews cannot acquire the admin preload", async () => {
  const f = await fixture();
  assert.equal(f.window.open({ url: "https://untrusted.example" }).action, "deny");
  for (const name of ["will-navigate", "will-redirect", "will-attach-webview"]) {
    let prevented = false;
    f.sender.emit(
      name,
      {
        preventDefault() {
          prevented = true;
        },
      },
      "https://untrusted.example",
    );
    assert.equal(prevented, true, name);
  }
});

test("release upload requires a file chosen in this window, and a late picker loses its grant", async () => {
  const f = await fixture();
  assert.throws(
    () => f.handlers.get("release:upload")(f.event, { filePath: "/private" }),
    /文件选择器/,
  );
  assert.equal((await f.handlers.get("dialog:select-release")(f.event)).filePath, "/chosen.exe");
  // The grant is valid; missing network metadata is now the next validation boundary.
  await assert.rejects(
    f.handlers.get("release:upload")(f.event, { filePath: "/chosen.exe" }),
    /缺少必要参数/,
  );
  /** @type {(value: { canceled: boolean, filePaths: string[] }) => void} */
  let complete = () => {};
  f.controls.pick = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  const pending = f.handlers.get("dialog:select-release")(f.event);
  f.window.emit("closed");
  complete({ canceled: false, filePaths: ["/other.exe"] });
  await assert.rejects(pending, /无权/);
});
