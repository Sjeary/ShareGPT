const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  assertRequestedAutoUpdate,
  flushUpdateStorage,
  installVerifiedAutoUpdate,
  launchVerifiedAutoUpdate,
} = require("../autoUpdateInstall");

function info(version, fileName) {
  return {
    version,
    files: [{ url: fileName }],
    path: fileName,
    downloadedFile: `C:\\Temp\\${fileName}`,
  };
}

class MockUpdater extends EventEmitter {
  constructor(available, downloaded = available) {
    super();
    this.available = available;
    this.downloaded = downloaded;
    this.downloads = 0;
  }
  async checkForUpdates() {
    queueMicrotask(() => this.emit("update-available", this.available));
  }
  async downloadUpdate() {
    this.downloads += 1;
    queueMicrotask(() => this.emit("update-downloaded", this.downloaded));
  }
}

const expectedRelease = { version: "1.0.9", fileName: "sharegpt-1.0.9.exe" };

test("renderer install request must match the current GitHub Latest release", () => {
  assert.deepEqual(
    assertRequestedAutoUpdate(expectedRelease, { ...expectedRelease }),
    expectedRelease,
  );
  assert.throws(
    () => assertRequestedAutoUpdate(expectedRelease, { ...expectedRelease, version: "6.0.0" }),
    /GitHub 最新版本/,
  );
  assert.throws(
    () =>
      assertRequestedAutoUpdate(expectedRelease, {
        ...expectedRelease,
        fileName: "sharegpt-sender-1.0.9.exe",
      }),
    /版本契约无效/,
  );
});

test("matching metadata downloads once, prepares, and removes listeners", async () => {
  const updater = new MockUpdater(info("1.0.9", "sharegpt-1.0.9.exe"));
  let prepared = 0;
  const result = await installVerifiedAutoUpdate({
    autoUpdater: updater,
    expectedRelease,
    beforeInstall: async () => (prepared += 1),
  });
  assert.deepEqual(result, { updated: true, installing: true });
  assert.equal(updater.downloads, 1);
  assert.equal(prepared, 1);
  assert.equal(updater.listenerCount("update-available"), 0);
});

test("mismatched version or product is rejected before download", async () => {
  for (const bad of [
    info("6.0.0", "sharegpt-6.0.0.exe"),
    info("1.0.9", "sharegpt-sender-1.0.9.exe"),
  ]) {
    const updater = new MockUpdater(bad);
    await assert.rejects(
      installVerifiedAutoUpdate({
        autoUpdater: updater,
        expectedRelease,
        beforeInstall: async () => {},
      }),
      /已停止下载/,
    );
    assert.equal(updater.downloads, 0);
  }
});

test("canonical legacy path cannot hide another files entry", async () => {
  const mixed = info("1.0.9", "sharegpt-other-1.0.9.exe");
  mixed.path = "sharegpt-1.0.9.exe";
  const updater = new MockUpdater(mixed);
  await assert.rejects(
    installVerifiedAutoUpdate({
      autoUpdater: updater,
      expectedRelease,
      beforeInstall: async () => {},
    }),
    /已停止下载/,
  );
  assert.equal(updater.downloads, 0);
});

test("downloaded filename is independently checked before backup", async () => {
  const downloaded = info("1.0.9", "sharegpt-1.0.9.exe");
  downloaded.downloadedFile = "C:\\Temp\\sharegpt-other-1.0.9.exe";
  const updater = new MockUpdater(info("1.0.9", "sharegpt-1.0.9.exe"), downloaded);
  let prepared = 0;
  await assert.rejects(
    installVerifiedAutoUpdate({
      autoUpdater: updater,
      expectedRelease,
      beforeInstall: async () => (prepared += 1),
    }),
    /已停止下载/,
  );
  assert.equal(prepared, 0);
});

test("synchronous check errors remove temporary listeners", async () => {
  class BrokenUpdater extends EventEmitter {
    checkForUpdates() {
      throw new Error("sync failure");
    }
  }
  const updater = new BrokenUpdater();
  await assert.rejects(
    installVerifiedAutoUpdate({
      autoUpdater: updater,
      expectedRelease,
      beforeInstall: async () => {},
    }),
    /sync failure/,
  );
  assert.equal(updater.listenerCount("error"), 0);
});

test("a failed AI session flush blocks update preparation", async () => {
  const flushed = [];
  await assert.rejects(
    flushUpdateStorage(["persist:a", "persist:b"], (partition) => ({
      async flushStorageData() {
        flushed.push(partition);
        if (partition === "persist:b") throw new Error("disk failure");
      },
    })),
    /无法写盘/,
  );
  assert.deepEqual(flushed.sort(), ["persist:a", "persist:b"]);
});

test("a synchronous quitAndInstall failure is reported instead of swallowed", () => {
  const failures = [];
  const launched = launchVerifiedAutoUpdate(
    {
      quitAndInstall() {
        throw new Error("installer launch failed");
      },
    },
    (error) => failures.push(error.message),
  );
  assert.equal(launched, false);
  assert.deepEqual(failures, ["installer launch failed"]);
});

test("a verified updater is launched with the explicit install options", () => {
  const calls = [];
  assert.equal(
    launchVerifiedAutoUpdate({ quitAndInstall: (...args) => calls.push(args) }, () =>
      assert.fail("successful install must not report an error"),
    ),
    true,
  );
  assert.deepEqual(calls, [[true, true]]);
});
