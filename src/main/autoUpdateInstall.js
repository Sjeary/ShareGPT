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
    Promise.resolve(autoUpdater.checkForUpdates()).catch(fail);
  });
}

module.exports = {
  assertExpectedAutoUpdate,
  installVerifiedAutoUpdate,
  normalizeAutoUpdateExpectation,
  updateAssetFileName,
};
