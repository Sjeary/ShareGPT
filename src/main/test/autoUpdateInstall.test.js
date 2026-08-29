const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  installVerifiedAutoUpdate,
  normalizeAutoUpdateExpectation,
  updateAssetFileName,
} = require("../autoUpdateInstall");

class MockAutoUpdater extends EventEmitter {
  constructor(updateInfo, downloadedInfo = updateInfo) {
    super();
    this.updateInfo = updateInfo;
    this.downloadedInfo = downloadedInfo;
    this.downloads = 0;
    this.checkMode = "available";
    this.downloadMode = "downloaded";
  }

  async checkForUpdates() {
    if (this.checkMode === "throw") throw new Error("check failed");
    queueMicrotask(() => {
      if (this.checkMode === "not-available") {
        this.emit("update-not-available", this.updateInfo);
      } else if (this.checkMode === "error-event") {
        this.emit("error", "check event failed");
      } else {
        this.emit("update-available", this.updateInfo);
        if (this.checkMode === "duplicate") this.emit("update-available", this.updateInfo);
      }
    });
  }

  async downloadUpdate() {
    this.downloads += 1;
    if (this.downloadMode === "throw") throw new Error("download failed");
    queueMicrotask(() => this.emit("update-downloaded", this.downloadedInfo));
  }
}

class SyncCheckFailureUpdater extends EventEmitter {
  checkForUpdates() {
    throw new Error("sync check failed");
  }

  async downloadUpdate() {
    assert.fail("must not download");
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

function assertInstallListenersRemoved(updater) {
  for (const event of ["update-available", "update-not-available", "update-downloaded", "error"]) {
    assert.equal(updater.listenerCount(event), 0, `${event} listener leaked`);
  }
}

test("update filenames normalize URLs and malformed URL-like input", () => {
  assert.equal(
    updateAssetFileName("https://github.com/Sjeary/ShareGPT/sharegpt-1.0.9.exe?download=1"),
    "sharegpt-1.0.9.exe",
  );
  assert.equal(updateAssetFileName("http://[/?name=sharegpt-1.0.9.exe"), "[");
  assert.equal(updateAssetFileName(""), "");
});

test("update expectation rejects invalid versions and product filenames", () => {
  assert.throws(
    () => normalizeAutoUpdateExpectation({ version: "latest", fileName: "sharegpt-latest.exe" }),
    /版本契约无效/,
  );
  assert.throws(
    () =>
      normalizeAutoUpdateExpectation({ version: "1.0.9", fileName: "sharegpt-sender-1.0.9.exe" }),
    /版本契约无效/,
  );
});

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
  assertInstallListenersRemoved(updater);
});

test("matching filenames are case-insensitive across metadata and downloaded path", async () => {
  const info = updateInfo("1.0.9", "SHAREGPT-1.0.9.EXE");
  const updater = new MockAutoUpdater(info);
  const result = await installVerifiedAutoUpdate({
    autoUpdater: updater,
    expectedRelease,
    beforeInstall: async () => {},
  });
  assert.equal(result.updated, true);
});

test("legacy metadata with only the canonical path remains supported", async () => {
  const info = updateInfo("1.0.9", "sharegpt-1.0.9.exe");
  delete info.files;
  const updater = new MockAutoUpdater(info);
  const result = await installVerifiedAutoUpdate({
    autoUpdater: updater,
    expectedRelease,
    beforeInstall: async () => {},
  });
  assert.equal(result.updated, true);
});

test("empty advertised file metadata is rejected", async () => {
  const info = updateInfo("1.0.9", "sharegpt-1.0.9.exe");
  info.files = [];
  info.path = "";
  const updater = new MockAutoUpdater(info);
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

test("no available update resolves without downloading and removes listeners", async () => {
  const updater = new MockAutoUpdater(updateInfo("1.0.9", "sharegpt-1.0.9.exe"));
  updater.checkMode = "not-available";
  const result = await installVerifiedAutoUpdate({
    autoUpdater: updater,
    expectedRelease,
    beforeInstall: async () => assert.fail("must not prepare"),
  });
  assert.deepEqual(result, { updated: false });
  assert.equal(updater.downloads, 0);
  assertInstallListenersRemoved(updater);
});

test("asynchronous check failures reject and remove listeners", async () => {
  const updater = new MockAutoUpdater(updateInfo("1.0.9", "sharegpt-1.0.9.exe"));
  updater.checkMode = "throw";
  await assert.rejects(
    installVerifiedAutoUpdate({
      autoUpdater: updater,
      expectedRelease,
      beforeInstall: async () => {},
    }),
    /check failed/,
  );
  assertInstallListenersRemoved(updater);
});

test("synchronous check failures reject and remove listeners", async () => {
  const updater = new SyncCheckFailureUpdater();
  await assert.rejects(
    installVerifiedAutoUpdate({
      autoUpdater: updater,
      expectedRelease,
      beforeInstall: async () => {},
    }),
    /sync check failed/,
  );
  assertInstallListenersRemoved(updater);
});

test("updater error events normalize non-Error values and remove listeners", async () => {
  const updater = new MockAutoUpdater(updateInfo("1.0.9", "sharegpt-1.0.9.exe"));
  updater.checkMode = "error-event";
  await assert.rejects(
    installVerifiedAutoUpdate({
      autoUpdater: updater,
      expectedRelease,
      beforeInstall: async () => {},
    }),
    /check event failed/,
  );
  assertInstallListenersRemoved(updater);
});

test("download failures reject and remove listeners", async () => {
  const updater = new MockAutoUpdater(updateInfo("1.0.9", "sharegpt-1.0.9.exe"));
  updater.downloadMode = "throw";
  await assert.rejects(
    installVerifiedAutoUpdate({
      autoUpdater: updater,
      expectedRelease,
      beforeInstall: async () => {},
    }),
    /download failed/,
  );
  assert.equal(updater.downloads, 1);
  assertInstallListenersRemoved(updater);
});

test("backup failures reject after download and remove listeners", async () => {
  const updater = new MockAutoUpdater(updateInfo("1.0.9", "sharegpt-1.0.9.exe"));
  await assert.rejects(
    installVerifiedAutoUpdate({
      autoUpdater: updater,
      expectedRelease,
      beforeInstall: async () => {
        throw new Error("backup failed");
      },
    }),
    /backup failed/,
  );
  assertInstallListenersRemoved(updater);
});

test("duplicate available events start only one download", async () => {
  const updater = new MockAutoUpdater(updateInfo("1.0.9", "sharegpt-1.0.9.exe"));
  updater.checkMode = "duplicate";
  const result = await installVerifiedAutoUpdate({
    autoUpdater: updater,
    expectedRelease,
    beforeInstall: async () => {},
  });
  assert.equal(result.updated, true);
  assert.equal(updater.downloads, 1);
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
