const path = require("node:path");
const { safeReleaseVersion } = require("./updateRelease");

function updateAssetFileName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return path.win32.basename(new URL(text, "https://updates.invalid/").pathname);
  } catch {
    return path.win32.basename(text.split(/[?#]/, 1)[0]);
  }
}

function normalizeAutoUpdateExpectation(value) {
  const version = safeReleaseVersion(value?.version);
  const fileName = updateAssetFileName(value?.fileName);
  const canonicalFileName = version ? `sharegpt-${version}.exe` : "";
  if (!version || fileName.toLowerCase() !== canonicalFileName.toLowerCase()) {
    throw new Error("更新版本契约无效，请重新检查 GitHub 最新版本");
  }
  return { version, fileName: canonicalFileName };
}

function assertRequestedAutoUpdate(expected, requested) {
  const expectation = normalizeAutoUpdateExpectation(expected);
  const request = normalizeAutoUpdateExpectation(requested);
  if (
    request.version !== expectation.version ||
    request.fileName.toLowerCase() !== expectation.fileName.toLowerCase()
  ) {
    throw new Error("更新信息已变化，请重新检查 GitHub 最新版本后再安装");
  }
  return expectation;
}

function assertExpectedAutoUpdate(info, expectation, { requireDownloadedFile = false } = {}) {
  const actualVersion = safeReleaseVersion(info?.version);
  const advertisedFiles = [
    ...(Array.isArray(info?.files) ? info.files.map((entry) => entry?.url) : []),
    info?.path,
  ]
    .map(updateAssetFileName)
    .filter(Boolean);
  const downloadedFile = updateAssetFileName(info?.downloadedFile);
  const expectedFileName = expectation.fileName.toLowerCase();
  const advertisedFilesMatch =
    advertisedFiles.length > 0 &&
    advertisedFiles.every((fileName) => fileName.toLowerCase() === expectedFileName);
  const downloadedFileMatches =
    !requireDownloadedFile || downloadedFile.toLowerCase() === expectedFileName;

  if (actualVersion !== expectation.version || !advertisedFilesMatch || !downloadedFileMatches) {
    throw new Error(`更新元数据与 GitHub Latest 不一致：期望 ${expectation.fileName}，已停止下载`);
  }
}

function installVerifiedAutoUpdate({ autoUpdater, expectedRelease, beforeInstall }) {
  const expectation = normalizeAutoUpdateExpectation(expectedRelease);
  return new Promise((resolve, reject) => {
    let downloadStarted = false;
    const cleanup = () => {
      autoUpdater.removeListener("update-available", onAvailable);
      autoUpdater.removeListener("update-not-available", onNotAvailable);
      autoUpdater.removeListener("update-downloaded", onDownloaded);
      autoUpdater.removeListener("error", onError);
    };
    const fail = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error?.message || error)));
    };
    const onAvailable = (info) => {
      try {
        assertExpectedAutoUpdate(info, expectation);
        if (downloadStarted) return;
        downloadStarted = true;
        Promise.resolve(autoUpdater.downloadUpdate()).catch(fail);
      } catch (error) {
        fail(error);
      }
    };
    const onNotAvailable = () => {
      cleanup();
      resolve({ updated: false });
    };
    const onDownloaded = async (info) => {
      try {
        assertExpectedAutoUpdate(info, expectation, { requireDownloadedFile: true });
        await beforeInstall();
        cleanup();
        resolve({ updated: true, installing: true });
      } catch (error) {
        fail(error);
      }
    };
    const onError = (error) => fail(error);

    autoUpdater.on("update-available", onAvailable);
    autoUpdater.on("update-not-available", onNotAvailable);
    autoUpdater.on("update-downloaded", onDownloaded);
    autoUpdater.on("error", onError);
    try {
      Promise.resolve(autoUpdater.checkForUpdates()).catch(fail);
    } catch (error) {
      fail(error);
    }
  });
}

function launchVerifiedAutoUpdate(autoUpdater, onError) {
  try {
    const launched = autoUpdater.quitAndInstall(true, true);
    if (launched === false) throw new Error("更新安装程序未能启动");
    return true;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error?.message || error));
    onError(failure);
    return false;
  }
}

async function flushUpdateStorage(partitions, fromPartition) {
  const unique = [...new Set((partitions || []).map((value) => String(value || "").trim()))].filter(
    Boolean,
  );
  const results = await Promise.allSettled(
    unique.map((partition) => fromPartition(partition).flushStorageData()),
  );
  const failures = results.flatMap((result, index) =>
    result.status === "rejected" ? [{ partition: unique[index], error: result.reason }] : [],
  );
  if (failures.length) {
    throw new AggregateError(
      failures.map((failure) => failure.error),
      `无法写盘 ${failures.length} 个 AI 会话`,
    );
  }
  return unique.length;
}

module.exports = {
  assertExpectedAutoUpdate,
  assertRequestedAutoUpdate,
  flushUpdateStorage,
  installVerifiedAutoUpdate,
  launchVerifiedAutoUpdate,
  normalizeAutoUpdateExpectation,
  updateAssetFileName,
};
