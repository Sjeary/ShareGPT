const asar = require("@electron/asar");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  assertLatestWindowsContract,
  assertWindowsAppUpdateContract,
  sha512Base64,
} = require("./windowsReleaseContract.cjs");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = String(packageJson.version || "").trim();
const releaseDir = String(process.env.SHAREGPT_RELEASE_DIR || "release").trim();

if (!releaseDir || path.isAbsolute(releaseDir) || releaseDir.split(/[\\/]+/).includes("..")) {
  throw new Error(`SHAREGPT_RELEASE_DIR 必须是仓库内的相对路径：${releaseDir}`);
}

function requiredFile(relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) throw new Error(`缺少发布产物：${relativePath}`);
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`发布产物为空：${relativePath}`);
  return { filePath, size: stat.size };
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const installerName = `sharegpt-${version}.exe`;
const installer = requiredFile(path.join(releaseDir, installerName));
const blockmap = requiredFile(path.join(releaseDir, `${installerName}.blockmap`));
const latest = requiredFile(path.join(releaseDir, "latest.yml"));
const appUpdate = requiredFile(
  path.join(releaseDir, "win-unpacked", "resources", "app-update.yml"),
);
const appAsar = requiredFile(path.join(releaseDir, "win-unpacked", "resources", "app.asar"));
const singBox = requiredFile(
  path.join(releaseDir, "win-unpacked", "resources", "bin", "sing-box.exe"),
);
const frpc = requiredFile(path.join(releaseDir, "win-unpacked", "resources", "bin", "frpc.exe"));
for (const duplicate of ["sing-box", "frpc"]) {
  const duplicatePath = path.join(
    root,
    releaseDir,
    "win-unpacked",
    "resources",
    "bin",
    "windows",
    `${duplicate}.exe`,
  );
  if (fs.existsSync(duplicatePath)) {
    throw new Error(`Windows 安装内容包含重复二进制：${path.relative(root, duplicatePath)}`);
  }
}

const packagedEntries = asar.listPackage(appAsar.filePath);
const localCacheEntries = packagedEntries.filter((entry) =>
  /(^|[\\/])\.npm-cache([\\/]|$)/.test(entry),
);
if (localCacheEntries.length > 0) {
  throw new Error(`app.asar 包含本机 npm 缓存：${localCacheEntries[0]}`);
}
const rendererIndex = packagedEntries.some(
  (entry) => entry.replace(/\\/g, "/").replace(/^\/+/, "") === "src/renderer-next/dist/index.html",
);
if (!rendererIndex) {
  throw new Error("app.asar 缺少 renderer 入口：src/renderer-next/dist/index.html");
}

const latestText = fs.readFileSync(latest.filePath, "utf8");
const installerBytes = fs.readFileSync(installer.filePath);
const latestMetadata = assertLatestWindowsContract(latestText, {
  version,
  installerName,
  installerSize: installer.size,
  installerSha512: sha512Base64(installerBytes),
});
const appUpdateMetadata = assertWindowsAppUpdateContract(
  fs.readFileSync(appUpdate.filePath, "utf8"),
  {
    expectedPublisherName: process.env.SHAREGPT_EXPECTED_WINDOWS_PUBLISHER,
    requirePublisherIdentity: process.env.SHAREGPT_REQUIRE_RELEASE_IDENTITY === "1",
  },
);

const checksumFile = path.join(root, "build", "bin", "checksums.json");
const checksums = JSON.parse(fs.readFileSync(checksumFile, "utf8"));
for (const [label, asset] of [
  ["sing-box", singBox],
  ["frpc", frpc],
]) {
  const expected = String(checksums?.[label]?.windows?.sha256 || "").toLowerCase();
  const actual = sha256(asset.filePath).toLowerCase();
  if (!expected || actual !== expected) {
    throw new Error(`${label} Windows 二进制校验失败：expected=${expected} actual=${actual}`);
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      target: "nsis",
      version,
      releaseDir,
      installer: {
        path: path.relative(root, installer.filePath),
        bytes: installer.size,
        sha256: sha256(installer.filePath),
      },
      blockmapBytes: blockmap.size,
      latestYml: path.relative(root, latest.filePath),
      latestSha512: latestMetadata.sha512,
      appUpdateYml: {
        path: path.relative(root, appUpdate.filePath),
        provider: appUpdateMetadata.provider,
        owner: appUpdateMetadata.owner,
        repo: appUpdateMetadata.repo,
        publisherNames: appUpdateMetadata.publisherNames,
      },
      packagedResources: {
        appAsarBytes: appAsar.size,
        npmCacheEntries: localCacheEntries.length,
        rendererIndex,
        singBoxBytes: singBox.size,
        frpcBytes: frpc.size,
      },
    },
    null,
    2,
  )}\n`,
);
