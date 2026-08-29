const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { installVerifiedAutoUpdate } = require("../autoUpdateInstall");

class MockAutoUpdater extends EventEmitter {
  constructor(updateInfo, downloadedInfo = updateInfo) {
    super();
    this.updateInfo = updateInfo;
    this.downloadedInfo = downloadedInfo;
    this.downloads = 0;
  }

  async checkForUpdates() {
    queueMicrotask(() => this.emit("update-available", this.updateInfo));
  }

  async downloadUpdate() {
    this.downloads += 1;
    queueMicrotask(() => this.emit("update-downloaded", this.downloadedInfo));
  }
}

function updateInfo(version, fileName) {
  return {
    version,
    files: [{ url: fileName }],
    path: fileName,
    downloadedFile: `C:\\Temp\\${fileName}`,
  };
}

const expectedRelease = {
  version: "1.0.9",
  fileName: "sharegpt-1.0.9.exe",
};

test("verified updater metadata downloads and prepares the expected release", async () => {
  const updater = new MockAutoUpdater(updateInfo("1.0.9", "sharegpt-1.0.9.exe"));
  let prepared = 0;
  const result = await installVerifiedAutoUpdate({
    autoUpdater: updater,
    expectedRelease,
    beforeInstall: async () => {
      prepared += 1;
    },
  });

  assert.deepEqual(result, { updated: true, installing: true });
  assert.equal(updater.downloads, 1);
  assert.equal(prepared, 1);
  assert.equal(updater.listenerCount("update-available"), 0);
});

test("mismatched latest.yml version is rejected before download", async () => {
  const updater = new MockAutoUpdater(updateInfo("6.0.0", "sharegpt-6.0.0.exe"));

  await assert.rejects(
    installVerifiedAutoUpdate({
      autoUpdater: updater,
      expectedRelease,
      beforeInstall: async () => {},
    }),
    /期望 sharegpt-1\.0\.9\.exe/,
  );
  assert.equal(updater.downloads, 0);
});

test("another product filename is rejected before download", async () => {
  const updater = new MockAutoUpdater(updateInfo("1.0.9", "sharegpt-sender-1.0.9.exe"));

  await assert.rejects(
    installVerifiedAutoUpdate({
      autoUpdater: updater,
      expectedRelease,
      beforeInstall: async () => {},
    }),
    /期望 sharegpt-1\.0\.9\.exe/,
  );
  assert.equal(updater.downloads, 0);
});

test("a canonical legacy path cannot hide a different files entry", async () => {
  const mixedInfo = updateInfo("1.0.9", "sharegpt-other-1.0.9.exe");
  mixedInfo.path = "sharegpt-1.0.9.exe";
  const updater = new MockAutoUpdater(mixedInfo);

  await assert.rejects(
    installVerifiedAutoUpdate({
      autoUpdater: updater,
      expectedRelease,
      beforeInstall: async () => {},
    }),
    /期望 sharegpt-1\.0\.9\.exe/,
  );
  assert.equal(updater.downloads, 0);
});

test("downloaded metadata is revalidated before backup and install", async () => {
  const updater = new MockAutoUpdater(
    updateInfo("1.0.9", "sharegpt-1.0.9.exe"),
    updateInfo("6.0.0", "sharegpt-6.0.0.exe"),
  );
  let prepared = 0;

  await assert.rejects(
    installVerifiedAutoUpdate({
      autoUpdater: updater,
      expectedRelease,
      beforeInstall: async () => {
        prepared += 1;
      },
    }),
    /期望 sharegpt-1\.0\.9\.exe/,
  );
  assert.equal(updater.downloads, 1);
  assert.equal(prepared, 0);
});

test("a different downloaded filename is rejected before backup and install", async () => {
  const downloadedInfo = updateInfo("1.0.9", "sharegpt-1.0.9.exe");
  downloadedInfo.downloadedFile = "C:\\Temp\\sharegpt-other-1.0.9.exe";
  const updater = new MockAutoUpdater(updateInfo("1.0.9", "sharegpt-1.0.9.exe"), downloadedInfo);
  let prepared = 0;

  await assert.rejects(
    installVerifiedAutoUpdate({
      autoUpdater: updater,
      expectedRelease,
      beforeInstall: async () => {
        prepared += 1;
      },
    }),
    /期望 sharegpt-1\.0\.9\.exe/,
  );
  assert.equal(updater.downloads, 1);
  assert.equal(prepared, 0);
});
